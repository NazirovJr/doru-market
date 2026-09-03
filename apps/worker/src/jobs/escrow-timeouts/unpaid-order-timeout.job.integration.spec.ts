/**
 * Интеграционный тест `UnpaidOrderTimeoutJob` (DTJ-253, TC-ORD-013) — РЕАЛЬНЫЙ Postgres (сканер
 * находит просроченные заказы РЕАЛЬНЫМ SQL-запросом, не мок) + локальный HTTP-сервер-заглушка
 * с ТОЙ ЖЕ сигнатурой, что `POST /api/v1/internal/orders/:id/system-cancel` (apps/api) — тот же
 * приём, что `mock-bank-auto-pay.job.integration.spec.ts` (DTJ-238): реальная мутация заказа
 * через РЕАЛЬНЫЙ `system-cancel-order.use-case.integration.spec.ts` (apps/api, отдельный файл,
 * покрывает свою половину моста), здесь — доказательство, что ЭТА половина (скан + HTTP-диспетч)
 * реально работает end-to-end против настоящей БД, не только против моков (`unpaid-order-timeout.
 * job.spec.ts`). Плюс реальный BullMQ `upsertJobScheduler` (правило задания про jobId-баг
 * DTJ-238 — заглушка очереди не поймала бы расхождение формы ответа).
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { UnpaidOrderTimeoutJob } from './unpaid-order-timeout.job.js'
import { PgUnpaidOrderScannerAdapter } from './pg-unpaid-order-scanner.adapter.js'
import { UNPAID_ORDER_TIMEOUT_QUEUE } from './unpaid-order-timeout.constants.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/2'
const PROBE_TIMEOUT_MS = 1_500
const INTERNAL_API_KEY = 'test-dtj253-integration-key'
const EPHEMERAL_PORT = 0

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
  readonly body: Record<string, unknown>
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

/** Заглушка `POST /api/v1/internal/orders/:id/system-cancel` — та же форма ответа, что реальный
 * контроллер (`{ data: { orderId, status, refundIssued } }`), см. JSDoc файла. */
function startStandInServer(captured: CapturedRequest[], respondStatus: 'cancelled' | 'skipped' = 'cancelled'): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        const orderId = (req.url ?? '').split('/').at(-2) ?? '?'
        captured.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw.toString('utf8')) as Record<string, unknown> })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: { orderId, status: respondStatus, refundIssued: false } }))
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

describe.skipIf(!postgresAvailable)('UnpaidOrderTimeoutJob — integration (DTJ-253)', () => {
  let pool: Pool
  const tenantId = randomUUID()
  let customerId: string
  const createdOrderIds: string[] = []
  let orderNumberSeq = 0

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj253-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    }
  })

  async function seedOrder(input: { status: string; paymentMethod: string; paymentWindowExpiresAt: Date | null }): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, status, payment_method, payment_window_expires_at,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, $5, $6, 20.00, 5.00, 25.00, 'Dushanbe, Rudaki 1', $7, $8)`,
      [
        orderId,
        `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`,
        customerId,
        input.status,
        input.paymentMethod,
        input.paymentWindowExpiresAt,
        tenantId,
        randomUUID(),
      ],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('TC-ORD-013: заказ pending_payment с истёкшим окном — сканер находит, HTTP-мост вызывается с корректными tenantId/reason', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const orderId = await seedOrder({
        status: 'pending_payment',
        paymentMethod: 'alif_mobi',
        paymentWindowExpiresAt: new Date(Date.now() - 60_000), // минуту назад — просрочен
      })
      const job = new UnpaidOrderTimeoutJob(new PgUnpaidOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

      const result = await job.runOnce()

      expect(result.cancelled).toBeGreaterThanOrEqual(1)
      const call = captured.find((c) => c.url.includes(orderId))
      expect(call).toBeDefined()
      expect(call?.headers['x-internal-api-key']).toBe(INTERNAL_API_KEY)
      expect(call?.body).toEqual({ tenantId, expectedFromStatus: 'pending_payment', reason: 'payment_timeout' })
    } finally {
      server.close()
    }
  })

  it('заказ cash_courier (confirmed) — payment_window_expires_at всегда NULL для cash, НЕ попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const orderId = await seedOrder({ status: 'confirmed', paymentMethod: 'cash_courier', paymentWindowExpiresAt: null })
      const job = new UnpaidOrderTimeoutJob(new PgUnpaidOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(orderId))).toBe(false)
    } finally {
      server.close()
    }
  })

  it('заказ pending_payment с ещё будущим окном — не попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const orderId = await seedOrder({
        status: 'pending_payment',
        paymentMethod: 'alif_mobi',
        paymentWindowExpiresAt: new Date(Date.now() + 900_000), // через 15 минут
      })
      const job = new UnpaidOrderTimeoutJob(new PgUnpaidOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(orderId))).toBe(false)
    } finally {
      server.close()
    }
  })

  describe('реальный BullMQ (правило задания про jobId-баг DTJ-238 — не тестировать только заглушкой)', () => {
    let redis: IORedis
    let queue: Queue

    beforeAll(() => {
      redis = new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
      queue = new Queue(UNPAID_ORDER_TIMEOUT_QUEUE, { connection: redis })
    })

    afterAll(async () => {
      await queue.close()
      redis.disconnect()
    })

    it('upsertJobScheduler регистрирует реальный BullMQ repeat-scheduler без ошибок', async () => {
      try {
        await expect(
          queue.upsertJobScheduler('dtj253-test-scheduler', { pattern: '*/2 * * * *', tz: 'Asia/Dushanbe' }, { name: 'unpaid-order-timeout-tick' }),
        ).resolves.toBeDefined()
        const schedulers = await queue.getJobSchedulers()
        expect(schedulers.some((s) => s.key === 'dtj253-test-scheduler')).toBe(true)
      } finally {
        await queue.removeJobScheduler('dtj253-test-scheduler')
      }
    })
  })
})
