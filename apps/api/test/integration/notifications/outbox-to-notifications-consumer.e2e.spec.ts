/**
 * Реальный BullMQ+Postgres. АС1: одно событие, обработанное `consumer.process()` дважды (redelivery),
 * даёт ровно одну строку `notifications`. АС5: `order.courier_assigned` — две записи (customer+courier).
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Test, type TestingModule } from '@nestjs/testing'
import IORedis from 'ioredis'
import { Queue } from 'bullmq'
import { Pool } from 'pg'
import type { OutboxToNotificationsConsumer } from '@/modules/notifications/infrastructure/consumers/outbox-to-notifications.consumer.js'

const TEST_DATABASE_URL = process.env.NOTIFICATIONS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const TEST_REDIS_URL = process.env.NOTIFICATIONS_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6380/0'
const PROBE_TIMEOUT_MS = 1_500
const TEST_TIMEOUT_MS = 20_000
const WAIT_MARGIN_MS = 8_000

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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_notifications_e2e',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-notifications-e2e',
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

interface SeededTenant {
  readonly tenantId: string
}

async function seedTenant(pool: Pool, brandName: string): Promise<SeededTenant> {
  const tenantId = randomUUID()
  await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj370-${tenantId.slice(0, 8)}`])
  await pool.query(`INSERT INTO tenant_settings (tenant_id, brand_name) VALUES ($1, $2)`, [tenantId, brandName])
  return { tenantId }
}

interface SeedUserInput {
  readonly tenantId: string
  readonly role: string
  readonly telegramChatId: bigint
}

async function seedUser(pool: Pool, input: SeedUserInput): Promise<string> {
  const userId = randomUUID()
  await pool.query(
    `INSERT INTO users (id, tenant_id, role, telegram_chat_id, preferred_locale) VALUES ($1, $2, $3, $4, 'ru')`,
    [userId, input.tenantId, input.role, input.telegramChatId.toString()],
  )
  return userId
}

async function seedInAppTemplate(pool: Pool, eventType: string): Promise<void> {
  await pool.query(
    `INSERT INTO notification_templates (event_type, channel, locale, subject, body, variables_schema)
     VALUES ($1, 'in_app', 'ru', NULL, $2, $3::jsonb)
     ON CONFLICT (event_type, channel, locale) DO UPDATE SET body = excluded.body`,
    [eventType, '{{brandName}}: заказ {{orderNumber}}', JSON.stringify({ required: ['brandName', 'orderNumber'] })],
  )
}

describe.skipIf(!postgresAvailable || !redisAvailable)('OutboxToNotificationsConsumer — e2e (DTJ-370, реальный BullMQ + Postgres)', () => {
  let pool: Pool
  let domainEventsQueue: Queue
  let moduleRef: TestingModule
  let consumer: OutboxToNotificationsConsumer

  beforeAll(async () => {
    applyRequiredTestEnv()

    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    const { NotificationsModule } = await import('@/modules/notifications/notifications.module.js')
    const { OutboxToNotificationsConsumer: ConsumerClass } = await import(
      '@/modules/notifications/infrastructure/consumers/outbox-to-notifications.consumer.js'
    )

    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, IdempotencyModule, NotificationsModule],
    }).compile()
    await moduleRef.init()

    consumer = moduleRef.get(ConsumerClass)

    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    domainEventsQueue = new Queue('domain-events', { connection: new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null }) })
  })

  afterAll(async () => {
    await domainEventsQueue.close()
    await pool.end()
    await moduleRef.close()
  })

  it(
    'АС1/TC-ADM-022: одно событие обработано consumer.process() дважды (redelivery того же Job) → ОДНА строка notifications на user×channel',
    async () => {
      const { tenantId } = await seedTenant(pool, 'DTJ-370 e2e Brand')
      const userId = await seedUser(pool, { tenantId, role: 'customer', telegramChatId: 111222333n })
      await seedInAppTemplate(pool, 'order.paid')

      const eventId = randomUUID()
      const jobData = { recipients: { customer: userId }, variables: { orderNumber: '42' } }

      await domainEventsQueue.add('order.paid', jobData, { jobId: eventId })

      await expect
        .poll(
          async () => {
            const result = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'in_app'`, [userId])
            return result.rows[0]?.n ?? 0
          },
          { timeout: WAIT_MARGIN_MS, interval: 100 },
        )
        .toBe(1)

      // redelivery того же job'а — processed_events guard обязан заблокировать повторную обработку.
      await consumer.process({ id: eventId, name: 'order.paid', data: jobData } as unknown as Parameters<OutboxToNotificationsConsumer['process']>[0])

      const finalCount = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'in_app' AND source_event_id = $2`,
        [userId, eventId],
      )
      expect(finalCount.rows[0]?.n).toBe(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'АС5: order.courier_assigned — ДВЕ независимые записи notifications (customer + courier)',
    async () => {
      const { tenantId } = await seedTenant(pool, 'DTJ-370 e2e Brand 2')
      const customerId = await seedUser(pool, { tenantId, role: 'customer', telegramChatId: 444555666n })
      const courierId = await seedUser(pool, { tenantId, role: 'courier', telegramChatId: 777888999n })
      await seedInAppTemplate(pool, 'order.courier_assigned')

      const eventId = randomUUID()
      const jobData = { recipients: { customer: customerId, courier: courierId }, variables: { orderNumber: '43' } }
      await domainEventsQueue.add('order.courier_assigned', jobData, { jobId: eventId })

      await expect
        .poll(
          async () => {
            const result = await pool.query(`SELECT user_id FROM notifications WHERE source_event_id = $1 AND channel = 'in_app'`, [eventId])
            return result.rows.length
          },
          { timeout: WAIT_MARGIN_MS, interval: 100 },
        )
        .toBe(2)

      const rows = await pool.query<{ user_id: string }>(`SELECT user_id FROM notifications WHERE source_event_id = $1 AND channel = 'in_app'`, [eventId])
      const recipientIds = rows.rows.map((row) => row.user_id).sort()
      expect(recipientIds).toEqual([customerId, courierId].sort())
    },
    TEST_TIMEOUT_MS,
  )
})
