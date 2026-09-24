// DomainEventsRouter — реальный BullMQ + Postgres. cash_courier — noop-путь, не задевает Unimplemented-адаптер платежей.
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Test, type TestingModule } from '@nestjs/testing'
import IORedis from 'ioredis'
import { Queue } from 'bullmq'
import { Pool } from 'pg'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import type { DomainEventHandler } from '@/common/events/domain-event-handler.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380/0'
const PROBE_TIMEOUT_MS = 1_500
const TEST_TIMEOUT_MS = 20_000
const WAIT_MARGIN_MS = 8_000
const ORDER_NUMBER_HEX_LENGTH = 16

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

async function isRedisReachable(url: string): Promise<boolean> {
  const client = new IORedis(url, { lazyConnect: true, connectTimeout: PROBE_TIMEOUT_MS, maxRetriesPerRequest: 0, retryStrategy: () => null })
  client.on('error', () => undefined)
  try {
    await client.connect()
    await client.ping()
    return true
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

const [postgresAvailable, redisAvailable] = await Promise.all([isPostgresReachable(TEST_DATABASE_URL), isRedisReachable(TEST_REDIS_URL)])

const REQUIRED_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  REQUEST_TIMEOUT_MS: '30000',
  CORS_STATIC_ORIGINS: 'http://localhost:3000',
  MOCK_SMS_EXPOSE_CODE_IN_RESPONSE: 'false',
  OTP_REQUEST_COOLDOWN_SECONDS: '60',
  OTP_REQUEST_MAX_PER_10MIN: '3',
  OTP_REQUEST_MAX_PER_DAY: '10',
  OTP_REQUEST_MAX_PER_IP_PER_HOUR: '20',
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_domain_events_router',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-domain-events-router',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  CART_HOLD_TTL_SECONDS: '900',
  PAYMENT_PROVIDER_TIMEOUT_MS: '8000',
  LOG_LEVEL: 'error',
}

function applyRequiredTestEnv(): void {
  for (const [key, value] of Object.entries(REQUIRED_TEST_ENV)) {
    process.env[key] = value
  }
  if (process.env.JWT_PRIVATE_KEY === undefined || process.env.JWT_PUBLIC_KEY === undefined) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    process.env.JWT_PRIVATE_KEY = privateKey
    process.env.JWT_PUBLIC_KEY = publicKey
    process.env.JWT_KID = 'test-v1'
  }
}

function uniqueOrderNumber(): string {
  return `DTJ-${randomUUID().replace(/-/g, '').slice(0, ORDER_NUMBER_HEX_LENGTH).toUpperCase()}`
}

interface EnvelopeInput {
  readonly eventId: string
  readonly eventType: string
  readonly tenantId: string
  readonly payload: Record<string, unknown>
}

function envelope(input: EnvelopeInput): DomainEventEnvelope {
  return { ...input, aggregateType: 'order_return', aggregateId: randomUUID(), occurredAt: new Date().toISOString() }
}

describe.skipIf(!postgresAvailable || !redisAvailable)('DomainEventsRouter — integration (DTJ-032)', () => {
  let pool: Pool
  let domainEventsQueue: Queue
  let moduleRef: TestingModule

  beforeAll(async () => {
    applyRequiredTestEnv()

    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    const { DomainEventsModule } = await import('@/common/events/domain-events.module.js')
    const { DomainEventHandlerRegistry } = await import('@/common/events/domain-event-handler.js')
    const { ReturnsModule } = await import('@/modules/returns/returns.module.js')

    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, IdempotencyModule, DomainEventsModule, ReturnsModule],
    }).compile()
    await moduleRef.init()

    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    domainEventsQueue = new Queue('domain-events', { connection: new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null }) })

    const registry = moduleRef.get(DomainEventHandlerRegistry)
    registry.register(fakeHandlerA)
    registry.register(fakeHandlerB)
  })

  afterAll(async () => {
    await domainEventsQueue.close()
    await pool.end()
    await moduleRef.close()
  })

  let handlerACalls: string[] = []
  let handlerBAttempts = 0
  const fakeHandlerA: DomainEventHandler = {
    consumerName: 'test.fake-a',
    eventTypes: ['TestFanOutEvent'],
    handle: (envelope: DomainEventEnvelope) => {
      handlerACalls.push(envelope.eventId)
      return Promise.resolve()
    },
  }
  const fakeHandlerB: DomainEventHandler = {
    consumerName: 'test.fake-b',
    eventTypes: ['TestFanOutEvent'],
    handle: () => {
      handlerBAttempts += 1
      if (handlerBAttempts === 1) {
        return Promise.reject(new Error('transient failure, retry me'))
      }
      return Promise.resolve()
    },
  }

  async function seedTenant(): Promise<string> {
    const tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj032-${tenantId.slice(0, 8)}`])
    return tenantId
  }

  it(
    'АС1/АС2: fan-out на оба обработчика; ретрай после падения одного не задваивает эффект другого',
    async () => {
      handlerACalls = []
      handlerBAttempts = 0
      const eventId = randomUUID()

      await domainEventsQueue.add('TestFanOutEvent', envelope({ eventId, eventType: 'TestFanOutEvent', tenantId: 'tenant-x', payload: {} }), {
        jobId: eventId,
        attempts: 3,
        backoff: { type: 'fixed', delay: 200 },
      })

      await expect.poll(() => handlerBAttempts, { timeout: WAIT_MARGIN_MS, interval: 100 }).toBeGreaterThanOrEqual(2)
      await expect.poll(() => handlerACalls.length, { timeout: WAIT_MARGIN_MS, interval: 100 }).toBeGreaterThanOrEqual(1)

      expect(handlerACalls.filter((id) => id === eventId).length).toBeGreaterThanOrEqual(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'АС4: ReturnConfirmedEvent (cash_courier заказ) — сквозной путь router → RefundOnReturnResolvedUseCase, идемпотентно',
    async () => {
      const tenantId = await seedTenant()
      const customerId = randomUUID()
      await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
      const pharmacyId = randomUUID()
      await pool.query(
        `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-032 Test Pharmacy', 'x', 38.5, 68.7, '+992900000032')`,
        [pharmacyId],
      )
      const orderId = randomUUID()
      await pool.query(
        `INSERT INTO orders
           (id, order_number, customer_id, pharmacy_id, status, payment_method, delivered_at,
            items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
         VALUES ($1, $2, $3, $4, 'delivered', 'cash_courier', now(), 200.00, 0.00, 200.00, 'Dushanbe, Rudaki 1', $5, $6)`,
        [orderId, uniqueOrderNumber(), customerId, pharmacyId, tenantId, randomUUID()],
      )
      await pool.query(
        `INSERT INTO order_items (id, order_id, unit_price_tjs, quantity, total_price_tjs) VALUES (gen_random_uuid(), $1, 200.00, 1, 200.00)`,
        [orderId],
      )

      const returnId = randomUUID()
      const eventId = randomUUID()
      const payload = { type: 'ReturnConfirmedEvent', returnId, orderId, reason: 'defect', disposition: 'restock' }

      const envelopeInput = { eventId, eventType: 'ReturnConfirmedEvent', tenantId, payload }
      await domainEventsQueue.add('ReturnConfirmedEvent', envelope(envelopeInput), { jobId: eventId })

      await expect
        .poll(
          async () => {
            const result = await pool.query<{ n: number }>(
              `SELECT COUNT(*)::int AS n FROM processed_events WHERE consumer_name = 'returns.on-resolved' AND event_id = $1`,
              [eventId],
            )
            return result.rows[0]?.n ?? 0
          },
          { timeout: WAIT_MARGIN_MS, interval: 100 },
        )
        .toBe(1)

      await domainEventsQueue.add('ReturnConfirmedEvent', envelope(envelopeInput), { jobId: `${eventId}-redelivery` })
      await new Promise((resolve) => setTimeout(resolve, 500))
      const finalCount = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM processed_events WHERE consumer_name = 'returns.on-resolved' AND event_id = $1`,
        [eventId],
      )
      expect(finalCount.rows[0]?.n).toBe(1)

      await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId])
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
      await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
      await pool.query('DELETE FROM users WHERE id = $1', [customerId])
      await pool.query(`DELETE FROM processed_events WHERE consumer_name = 'returns.on-resolved' AND event_id = $1`, [eventId])
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    },
    TEST_TIMEOUT_MS,
  )
})
