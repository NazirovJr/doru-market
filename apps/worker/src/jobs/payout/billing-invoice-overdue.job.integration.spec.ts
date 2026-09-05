/**
 * Интеграционный тест `BillingInvoiceOverdueJob` (DTJ-252, TC-PAY-013 буквально) — РЕАЛЬНЫЙ
 * Postgres (сканер находит просроченные `platform_billing_invoices` РЕАЛЬНЫМ SQL-запросом, не
 * мок) + локальный HTTP-сервер-заглушка с ТОЙ ЖЕ сигнатурой, что `POST /api/v1/internal/
 * pharmacy-chains/:id/suspend-for-unpaid-invoice` (apps/api) — тот же приём, что
 * `unpaid-order-timeout.job.integration.spec.ts` (DTJ-253): реальная приостановка сети через
 * РЕАЛЬНЫЙ `OnboardingFacade.suspendChainForUnpaidInvoice` покрыта ОТДЕЛЬНЫМ файлом
 * (`apps/api/test/integration/payments/suspend-chain-for-unpaid-invoice.integration.spec.ts`) —
 * здесь доказательство, что ЭТА половина моста (скан + HTTP-диспетч + локальный `issued→overdue`)
 * реально работает end-to-end против настоящей БД, не только против моков
 * (`billing-invoice-overdue.job.spec.ts`). Плюс реальный BullMQ `upsertJobScheduler` (правило
 * задания про jobId-баг DTJ-238 — заглушка очереди не поймала бы расхождение формы ответа).
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BillingInvoiceOverdueJob } from './billing-invoice-overdue.job.js'
import { PgBillingInvoiceOverdueAdapter } from './pg-billing-invoice-overdue.adapter.js'
import { BILLING_INVOICE_OVERDUE_QUEUE } from './billing-invoice-overdue.constants.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/2'
const PROBE_TIMEOUT_MS = 1_500
const INTERNAL_API_KEY = 'test-dtj252-integration-key'
const EPHEMERAL_PORT = 0
const GRACE_PERIOD_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

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

/** Заглушка `POST /api/v1/internal/pharmacy-chains/:id/suspend-for-unpaid-invoice` — та же форма ответа, что реальный контроллер. */
function startStandInServer(captured: CapturedRequest[], status = 200): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res) => {
      captured.push({ url: req.url ?? '', headers: req.headers })
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: { suspended: true } }))
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

describe.skipIf(!postgresAvailable)('BillingInvoiceOverdueJob — integration (DTJ-252, TC-PAY-013)', () => {
  let pool: Pool
  const chainId = randomUUID()
  const createdInvoiceIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, $2, $2, $3)`, [
      chainId,
      `DTJ-252 Chain ${chainId.slice(0, 8)}`,
      `TIN-${chainId.slice(0, 12)}`,
    ])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const invoiceId of createdInvoiceIds.splice(0)) {
      await pool.query('DELETE FROM platform_billing_invoices WHERE id = $1', [invoiceId]).catch(() => undefined)
    }
  })

  async function seedInvoice(input: { status: string; dueAt: Date | null }): Promise<string> {
    const invoiceId = randomUUID()
    const periodStart = new Date(Date.now() - 7 * DAY_MS)
    const periodEnd = new Date(Date.now())
    await pool.query(
      `INSERT INTO platform_billing_invoices
         (id, chain_id, invoice_type, status, period_start, period_end, subtotal_diram, vat_diram, total_diram, issued_at, due_at)
       VALUES ($1, $2, 'cash_courier_commission', $3, $4, $5, 10000, 1400, 11400, $6, $7)`,
      [invoiceId, chainId, input.status, periodStart, periodEnd, input.status === 'issued' ? periodEnd : null, input.dueAt],
    )
    createdInvoiceIds.push(invoiceId)
    return invoiceId
  }

  async function invoiceStatusOf(invoiceId: string): Promise<string> {
    const result = await pool.query<{ status: string }>('SELECT status FROM platform_billing_invoices WHERE id = $1', [invoiceId])
    const row = result.rows[0]
    if (row === undefined) throw new Error(`invoiceStatusOf: no row for ${invoiceId}`)
    return row.status
  }

  it('TC-PAY-013 АС1: due_at + grace_period истёк, не оплачен — сканер находит, HTTP-мост вызывается, локально issued→overdue', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      // due_at 5 дней назад + grace 3 дня = порог 2 дня назад — уже точно просрочен.
      const invoiceId = await seedInvoice({ status: 'issued', dueAt: new Date(Date.now() - 5 * DAY_MS) })
      const job = new BillingInvoiceOverdueJob(new PgBillingInvoiceOverdueAdapter(pool), GRACE_PERIOD_DAYS, {
        apiInternalUrl: serverUrl(server),
        internalApiKey: INTERNAL_API_KEY,
      })

      const result = await job.runOnce()

      expect(result.suspended).toBeGreaterThanOrEqual(1)
      const call = captured.find((c) => c.url.includes(chainId))
      expect(call).toBeDefined()
      expect(call?.url).toBe(`/api/v1/internal/pharmacy-chains/${chainId}/suspend-for-unpaid-invoice`)
      expect(call?.headers['x-internal-api-key']).toBe(INTERNAL_API_KEY)
      await expect(invoiceStatusOf(invoiceId)).resolves.toBe('overdue')
    } finally {
      server.close()
    }
  })

  it('TC-PAY-013 АС2: инвойс оплачен ДО истечения grace period (status=paid) — НЕ попадает в выборку, HTTP-мост НЕ вызывается', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const invoiceId = await seedInvoice({ status: 'paid', dueAt: new Date(Date.now() - 5 * DAY_MS) })
      const job = new BillingInvoiceOverdueJob(new PgBillingInvoiceOverdueAdapter(pool), GRACE_PERIOD_DAYS, {
        apiInternalUrl: serverUrl(server),
        internalApiKey: INTERNAL_API_KEY,
      })

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(chainId))).toBe(false)
      await expect(invoiceStatusOf(invoiceId)).resolves.toBe('paid') // не тронут
    } finally {
      server.close()
    }
  })

  it('issued, due_at ЕЩЁ в пределах grace period — не попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      // due_at вчера + grace 3 дня — порог ещё через 2 дня, не просрочен.
      await seedInvoice({ status: 'issued', dueAt: new Date(Date.now() - 1 * DAY_MS) })
      const job = new BillingInvoiceOverdueJob(new PgBillingInvoiceOverdueAdapter(pool), GRACE_PERIOD_DAYS, {
        apiInternalUrl: serverUrl(server),
        internalApiKey: INTERNAL_API_KEY,
      })

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(chainId))).toBe(false)
    } finally {
      server.close()
    }
  })

  it('draft-инвойс (ещё не issued) — не попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      await seedInvoice({ status: 'draft', dueAt: null })
      const job = new BillingInvoiceOverdueJob(new PgBillingInvoiceOverdueAdapter(pool), GRACE_PERIOD_DAYS, {
        apiInternalUrl: serverUrl(server),
        internalApiKey: INTERNAL_API_KEY,
      })

      await job.runOnce()

      expect(captured).toHaveLength(0)
    } finally {
      server.close()
    }
  })

  describe('реальный BullMQ (правило задания про jobId-баг DTJ-238 — не тестировать только заглушкой)', () => {
    let redis: IORedis
    let queue: Queue

    beforeAll(() => {
      redis = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
      queue = new Queue(BILLING_INVOICE_OVERDUE_QUEUE, { connection: redis })
    })

    afterAll(async () => {
      await queue.close()
      redis.disconnect()
    })

    it('upsertJobScheduler регистрирует реальный BullMQ repeat-scheduler без ошибок', async () => {
      try {
        await expect(
          queue.upsertJobScheduler('dtj252-test-scheduler', { pattern: '0 1 * * *', tz: 'Asia/Dushanbe' }, { name: 'billing-invoice-overdue-tick' }),
        ).resolves.toBeDefined()
        const schedulers = await queue.getJobSchedulers()
        expect(schedulers.some((s) => s.key === 'dtj252-test-scheduler')).toBe(true)
      } finally {
        await queue.removeJobScheduler('dtj252-test-scheduler')
      }
    })
  })
})
