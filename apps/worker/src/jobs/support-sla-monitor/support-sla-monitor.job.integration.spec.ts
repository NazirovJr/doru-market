/**
 * Интеграционный тест `SupportSlaMonitorJob` (DTJ-280) — РЕАЛЬНЫЙ Postgres (сканер находит
 * просроченные тикеты РЕАЛЬНЫМ SQL-запросом, не мок) + локальный HTTP-сервер-заглушка с ТОЙ ЖЕ
 * сигнатурой, что `POST /api/v1/internal/support-tickets/:id/escalate-priority` (apps/api) — тот
 * же приём, что `pickup-sla-timeout.job.integration.spec.ts` (DTJ-254): эта половина моста (скан +
 * HTTP-диспетч) доказывается ЗДЕСЬ против настоящей БД; РЕАЛЬНАЯ мутация `priority`/`SlaBreachedEvent`
 * — `escalate-ticket-priority.use-case.spec.ts` (apps/api, DTJ-280) — не дублируется здесь.
 *
 * ГЛАВНЫЙ фокус, специфичный этому тикету: (1) критерий приёмки 2 — тикет с УЖЕ заполненным
 * `first_responded_at` не попадает в выборку, даже если `first_response_due_at` в прошлом; (2)
 * критерий приёмки 3 — анти-дребезг: тикет с `last_escalated_at` МЕНЕЕ `reEscalationCooldownMinutes`
 * назад не попадает в выборку повторно.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SupportSlaMonitorJob } from './support-sla-monitor.job.js'
import { PgSupportSlaScannerAdapter } from './pg-support-sla-scanner.adapter.js'
import { SUPPORT_SLA_MONITOR_QUEUE } from './support-sla-monitor.constants.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/2'
const PROBE_TIMEOUT_MS = 1_500
const INTERNAL_API_KEY = 'test-dtj280-integration-key'
const EPHEMERAL_PORT = 0
const RE_ESCALATION_COOLDOWN_MINUTES = 30
const MINUTES_PAST_DUE = 20
const MINUTES_NOT_YET_DUE = -20

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

interface CapturedRequest {
  readonly url: string
  readonly headers: Record<string, string | string[] | undefined>
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

/** Заглушка `POST .../escalate-priority` — та же форма ответа, что реальный контроллер (`{ data: { ticketId, priority } }`). */
function startStandInServer(captured: CapturedRequest[]): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      void readBody(req).then(() => {
        const ticketId = (req.url ?? '').split('/').at(-2) ?? '?'
        captured.push({ url: req.url ?? '', headers: req.headers })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: { ticketId, priority: 1 } }))
      })
    })
    server.listen(EPHEMERAL_PORT, () => {
      resolve(server)
    })
  })
}

function serverUrl(server: Server): string {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('serverUrl: unexpected address')
  return `http://127.0.0.1:${String(address.port)}`
}

describe.skipIf(!postgresAvailable)('SupportSlaMonitorJob — integration (DTJ-280)', () => {
  let pool: Pool
  const tenantId = randomUUID()
  const createdTicketIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj280-${tenantId.slice(0, 8)}`])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const ticketId of createdTicketIds.splice(0)) {
      await pool.query('DELETE FROM support_tickets WHERE id = $1', [ticketId])
    }
  })

  async function seedTicket(input: {
    minutesPastDue: number
    firstRespondedAt?: Date
    lastEscalatedAt?: Date
    status?: string
  }): Promise<string> {
    const ticketId = randomUUID()
    await pool.query(
      `INSERT INTO support_tickets
         (id, tenant_id, channel, category, status, first_response_due_at, first_responded_at, last_escalated_at)
       VALUES ($1, $2, 'in_app', 'other', $3, NOW() - ($4 || ' minutes')::interval, $5, $6)`,
      [ticketId, tenantId, input.status ?? 'open', input.minutesPastDue, input.firstRespondedAt ?? null, input.lastEscalatedAt ?? null],
    )
    createdTicketIds.push(ticketId)
    return ticketId
  }

  it('критерий приёмки 1 — тикет open, first_response_due_at в прошлом, first_responded_at IS NULL → сканер находит, HTTP-мост вызван', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const ticketId = await seedTicket({ minutesPastDue: MINUTES_PAST_DUE })
      const job = new SupportSlaMonitorJob(
        new PgSupportSlaScannerAdapter(pool),
        serverUrl(server),
        INTERNAL_API_KEY,
        RE_ESCALATION_COOLDOWN_MINUTES,
      )

      const result = await job.runOnce()

      expect(result.escalated).toBeGreaterThanOrEqual(1)
      const call = captured.find((c) => c.url.includes(ticketId))
      expect(call).toBeDefined()
      expect(call?.headers['x-internal-api-key']).toBe(INTERNAL_API_KEY)
    } finally {
      server.close()
    }
  })

  it('критерий приёмки 2 (негативный) — first_responded_at ЗАПОЛНЕН, даже с истёкшим due_at → НЕ попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const ticketId = await seedTicket({ minutesPastDue: MINUTES_PAST_DUE, firstRespondedAt: new Date() })
      const job = new SupportSlaMonitorJob(
        new PgSupportSlaScannerAdapter(pool),
        serverUrl(server),
        INTERNAL_API_KEY,
        RE_ESCALATION_COOLDOWN_MINUTES,
      )

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(ticketId))).toBe(false)
    } finally {
      server.close()
    }
  })

  it('критерий приёмки 3 — тикет эскалирован 5 минут назад (< 30 минут cooldown) → анти-дребезг, НЕ попадает в выборку повторно', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
      const ticketId = await seedTicket({ minutesPastDue: MINUTES_PAST_DUE, lastEscalatedAt: fiveMinutesAgo })
      const job = new SupportSlaMonitorJob(
        new PgSupportSlaScannerAdapter(pool),
        serverUrl(server),
        INTERNAL_API_KEY,
        RE_ESCALATION_COOLDOWN_MINUTES,
      )

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(ticketId))).toBe(false)
    } finally {
      server.close()
    }
  })

  it('тикет эскалирован 40 минут назад (> 30 минут cooldown) → снова попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const fortyMinutesAgo = new Date(Date.now() - 40 * 60_000)
      const ticketId = await seedTicket({ minutesPastDue: MINUTES_PAST_DUE, lastEscalatedAt: fortyMinutesAgo })
      const job = new SupportSlaMonitorJob(
        new PgSupportSlaScannerAdapter(pool),
        serverUrl(server),
        INTERNAL_API_KEY,
        RE_ESCALATION_COOLDOWN_MINUTES,
      )

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(ticketId))).toBe(true)
    } finally {
      server.close()
    }
  })

  it('SLA ещё НЕ истёк (first_response_due_at в будущем) — не попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const ticketId = await seedTicket({ minutesPastDue: MINUTES_NOT_YET_DUE })
      const job = new SupportSlaMonitorJob(
        new PgSupportSlaScannerAdapter(pool),
        serverUrl(server),
        INTERNAL_API_KEY,
        RE_ESCALATION_COOLDOWN_MINUTES,
      )

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(ticketId))).toBe(false)
    } finally {
      server.close()
    }
  })

  it('тикет resolved (не open/in_progress), просрочен — не попадает в выборку (терминальный/предтерминальный статус вне периметра SLA-эскалации)', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const ticketId = await seedTicket({ minutesPastDue: MINUTES_PAST_DUE, status: 'resolved' })
      const job = new SupportSlaMonitorJob(
        new PgSupportSlaScannerAdapter(pool),
        serverUrl(server),
        INTERNAL_API_KEY,
        RE_ESCALATION_COOLDOWN_MINUTES,
      )

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(ticketId))).toBe(false)
    } finally {
      server.close()
    }
  })

  describe('реальный BullMQ (jobId-баг DTJ-238 — не тестировать только заглушкой)', () => {
    let redis: IORedis
    let queue: Queue

    beforeAll(() => {
      redis = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
      queue = new Queue(SUPPORT_SLA_MONITOR_QUEUE, { connection: redis })
    })

    afterAll(async () => {
      await queue.close()
      redis.disconnect()
    })

    it('upsertJobScheduler регистрирует реальный BullMQ repeat-scheduler без ошибок', async () => {
      try {
        await expect(
          queue.upsertJobScheduler('dtj280-test-scheduler', { pattern: '*/5 * * * *', tz: 'Asia/Dushanbe' }, { name: 'support-sla-monitor-tick' }),
        ).resolves.toBeDefined()
        const schedulers = await queue.getJobSchedulers()
        expect(schedulers.some((s) => s.key === 'dtj280-test-scheduler')).toBe(true)
      } finally {
        await queue.removeJobScheduler('dtj280-test-scheduler')
      }
    })
  })
})
