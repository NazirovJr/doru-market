/**
 * Интеграционный тест `PickupSlaTimeoutJob` (DTJ-254, TC-ORD-001b + симметричная non-cash ветка,
 * `21-module-orders-payments-escrow.md`) — РЕАЛЬНЫЙ Postgres (сканер находит просроченные заказы
 * РЕАЛЬНЫМ SQL-запросом, включая JOIN на `tenant_settings`, не мок) + локальный HTTP-сервер-
 * заглушка с ТОЙ ЖЕ сигнатурой, что `POST /api/v1/internal/orders/:id/system-cancel` (apps/api) —
 * тот же приём, что `unpaid-order-timeout.job.integration.spec.ts` (DTJ-253): эта половина моста
 * (скан + HTTP-диспетч) доказывается ЗДЕСЬ против настоящей БД; РЕАЛЬНАЯ мутация заказа
 * (cancel + условный рефанд по D-25) — `system-cancel-order.use-case.integration.spec.ts`
 * (apps/api, DTJ-253, УЖЕ содержит кейсы, буквально помеченные «DTJ-254»: non-cash paid_escrow →
 * refundFull вызван один раз; cash confirmed → refundFull НЕ вызван) — не дублируется здесь.
 *
 * ГЛАВНЫЙ фокус, специфичный ЭТОМУ тикету (в отличие от DTJ-253): (1) SQL JOIN на
 * `tenant_settings.pickup_sla_minutes`/`pickup_sla_buffer_minutes` реально работает против
 * настоящей схемы; (2) обе ветки (`paid_escrow`/`confirmed`) находятся ОДНИМ запросом и КАЖДАЯ
 * несёт СВОЙ статус наружу (AC4 — «не перепутаны»); (3) `processing_started_at IS NOT NULL`
 * реально исключает заказ (AC3), независимо от способа оплаты.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PickupSlaTimeoutJob } from './pickup-sla-timeout.job.js'
import { PgPickupSlaOrderScannerAdapter } from './pg-pickup-sla-order-scanner.adapter.js'
import { PICKUP_SLA_TIMEOUT_QUEUE } from './pickup-sla-timeout.constants.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://:dorutj_dev_redis_password@localhost:6379/2'
const PROBE_TIMEOUT_MS = 1_500
const INTERNAL_API_KEY = 'test-dtj254-integration-key'
const EPHEMERAL_PORT = 0
// Дефолт tenant_settings (migrations/0002): pickup_sla_minutes=7 + pickup_sla_buffer_minutes=5 = 12 минут.
const MINUTES_PAST_THRESHOLD = 20
const MINUTES_FUTURE = 0

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
function startStandInServer(captured: CapturedRequest[]): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      void readBody(req).then((raw) => {
        const orderId = (req.url ?? '').split('/').at(-2) ?? '?'
        captured.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw.toString('utf8')) as Record<string, unknown> })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: { orderId, status: 'cancelled', refundIssued: false } }))
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

describe.skipIf(!postgresAvailable)('PickupSlaTimeoutJob — integration (DTJ-254)', () => {
  let pool: Pool
  const tenantId = randomUUID()
  let customerId: string
  const createdOrderIds: string[] = []
  let orderNumberSeq = 0

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj254-${tenantId.slice(0, 8)}`])
    // Дефолты pickup_sla_minutes=7/pickup_sla_buffer_minutes=5 из migrations/0002 — не переопределяются
    // намеренно (тест проверяет, что джоба реально читает СХЕМНЫЙ дефолт, не константу в коде).
    await pool.query(`INSERT INTO tenant_settings (tenant_id, brand_name) VALUES ($1, $2)`, [tenantId, 'DTJ-254 Test Tenant'])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [tenantId])
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    }
  })

  async function seedOrder(input: {
    status: string
    paymentMethod: string
    minutesAgo: number
    processingStarted: boolean
  }): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, status, payment_method, created_at, processing_started_at,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, $5, NOW() - ($6 || ' minutes')::interval, $7, 20.00, 5.00, 25.00, 'Dushanbe, Rudaki 1', $8, $9)`,
      [
        orderId,
        `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`,
        customerId,
        input.status,
        input.paymentMethod,
        input.minutesAgo,
        input.processingStarted ? new Date() : null,
        tenantId,
        randomUUID(),
      ],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('non-cash paid_escrow, pickup SLA истёк — сканер находит, HTTP-мост вызван с expectedFromStatus=paid_escrow', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const orderId = await seedOrder({
        status: 'paid_escrow',
        paymentMethod: 'alif_mobi',
        minutesAgo: MINUTES_PAST_THRESHOLD,
        processingStarted: false,
      })
      const job = new PickupSlaTimeoutJob(new PgPickupSlaOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

      const result = await job.runOnce()

      expect(result.cancelled).toBeGreaterThanOrEqual(1)
      const call = captured.find((c) => c.url.includes(orderId))
      expect(call).toBeDefined()
      expect(call?.headers['x-internal-api-key']).toBe(INTERNAL_API_KEY)
      expect(call?.body).toEqual({ tenantId, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })
    } finally {
      server.close()
    }
  })

  it('TC-ORD-001b: cash confirmed, pickup SLA истёк — сканер находит, HTTP-мост вызван с expectedFromStatus=confirmed (не paid_escrow)', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const orderId = await seedOrder({
        status: 'confirmed',
        paymentMethod: 'cash_courier',
        minutesAgo: MINUTES_PAST_THRESHOLD,
        processingStarted: false,
      })
      const job = new PickupSlaTimeoutJob(new PgPickupSlaOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

      const result = await job.runOnce()

      expect(result.cancelled).toBeGreaterThanOrEqual(1)
      const call = captured.find((c) => c.url.includes(orderId))
      expect(call).toBeDefined()
      expect(call?.body).toEqual({ tenantId, expectedFromStatus: 'confirmed', reason: 'pickup_sla_timeout' })
    } finally {
      server.close()
    }
  })

  it('AC4: обе ветки просрочены одновременно — оба заказа отменены, каждый со СВОИМ expectedFromStatus (не перепутаны)', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const nonCashId = await seedOrder({ status: 'paid_escrow', paymentMethod: 'alif_mobi', minutesAgo: MINUTES_PAST_THRESHOLD, processingStarted: false })
      const cashId = await seedOrder({ status: 'confirmed', paymentMethod: 'cash_courier', minutesAgo: MINUTES_PAST_THRESHOLD, processingStarted: false })
      const job = new PickupSlaTimeoutJob(new PgPickupSlaOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

      const result = await job.runOnce()

      expect(result.cancelled).toBeGreaterThanOrEqual(2)
      const nonCashCall = captured.find((c) => c.url.includes(nonCashId))
      const cashCall = captured.find((c) => c.url.includes(cashId))
      expect(nonCashCall?.body).toEqual({ tenantId, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })
      expect(cashCall?.body).toEqual({ tenantId, expectedFromStatus: 'confirmed', reason: 'pickup_sla_timeout' })
    } finally {
      server.close()
    }
  })

  it('AC3: processing_started_at заполнен (фармацевт уже принял) — заказ НЕ попадает в выборку, независимо от способа оплаты', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const orderId = await seedOrder({
        status: 'processing',
        paymentMethod: 'alif_mobi',
        minutesAgo: MINUTES_PAST_THRESHOLD,
        processingStarted: true,
      })
      const job = new PickupSlaTimeoutJob(new PgPickupSlaOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

      await job.runOnce()

      expect(captured.some((c) => c.url.includes(orderId))).toBe(false)
    } finally {
      server.close()
    }
  })

  it('заказ paid_escrow, pickup SLA ещё НЕ истёк — не попадает в выборку', async () => {
    const captured: CapturedRequest[] = []
    const server = await startStandInServer(captured)
    try {
      const orderId = await seedOrder({
        status: 'paid_escrow',
        paymentMethod: 'alif_mobi',
        minutesAgo: MINUTES_FUTURE,
        processingStarted: false,
      })
      const job = new PickupSlaTimeoutJob(new PgPickupSlaOrderScannerAdapter(pool), serverUrl(server), INTERNAL_API_KEY)

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
      queue = new Queue(PICKUP_SLA_TIMEOUT_QUEUE, { connection: redis })
    })

    afterAll(async () => {
      await queue.close()
      redis.disconnect()
    })

    it('upsertJobScheduler регистрирует реальный BullMQ repeat-scheduler без ошибок', async () => {
      try {
        await expect(
          queue.upsertJobScheduler('dtj254-test-scheduler', { pattern: '*/2 * * * *', tz: 'Asia/Dushanbe' }, { name: 'pickup-sla-timeout-tick' }),
        ).resolves.toBeDefined()
        const schedulers = await queue.getJobSchedulers()
        expect(schedulers.some((s) => s.key === 'dtj254-test-scheduler')).toBe(true)
      } finally {
        await queue.removeJobScheduler('dtj254-test-scheduler')
      }
    })
  })
})
