/**
 * Интеграционный тест `MockBankProvider` (EP-10, DTJ-238, тест-план тикета) — РЕАЛЬНЫЙ
 * Postgres (не Testcontainers, D-EP09-14/31 — см. `payments-migration.integration.spec.ts`).
 *
 * ОТКЛОНЕНИЕ ОТ БУКВЫ ТЕСТ-ПЛАНА ТИКЕТА («Unit... на моке репозитория payment_operations»):
 * `MockBankProvider` работает с Drizzle НАПРЯМУЮ (нет отдельного репозитория-порта поверх
 * `payment_operations` — та же архитектура, что `DrizzleOrdersOutboxAdapter`/большинство
 * infrastructure-адаптеров этого проекта, где Drizzle-запрос — деталь ЕДИНСТВЕННОГО адаптера).
 * Мокать сам Drizzle query-builder (`.insert().values().onConflictDoNothing().returning()`)
 * дало бы тест, проверяющий структуру мока, а не поведение SQL/констрейнтов (идемпотентность
 * `ON CONFLICT`, реальный UNIQUE) — интеграционный прогон против настоящей БД даёт СИЛЬНЕЕ
 * гарантию для ровно того же риска (SRS-PAY-003). `Queue`/`AppConfigService` — заглушены
 * (`vi.fn()`), т.к. это не их зона ответственности здесь.
 *
 * НАЙДЕННЫЙ И ПОЧИНЕННЫЙ ДЕФЕКТ (задача 1, найдено исполнителем DTJ-241 рядом со своим
 * периметром, не починено им — см. `test/integration/orders/__tests__/test-app.ts`
 * `CreateTestAppOptions.fakeMockBankAutoPayQueue`): `enqueueWebhookJob()` строил `jobId` как
 * `${providerRef}:${type}` — реальный BullMQ (`node_modules/bullmq/dist/cjs/classes/job.js`)
 * отвергает такой id («Custom Id cannot contain :»), т.е. падал ЦЕЛИКОМ каждый
 * `createInvoice()`/`refund()` с `MOCK_BANK_AUTO_PAY_DELAY_MS > 0` против настоящего Redis —
 * не вебхук, а весь безналичный checkout. Все тесты ВЫШЕ в этом файле этого не ловили —
 * `Queue` заглушена (`{ add: vi.fn() }`), заглушка принимала то, что реальная библиотека
 * отвергает. Блок `enqueueWebhookJob() — РЕАЛЬНЫЙ BullMQ` в конце файла — регрессионный тест
 * именно на реальном BullMQ/Redis, не на моке.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import type { ConfigService } from '@nestjs/config'
import { Queue } from 'bullmq'
import Redis from 'ioredis'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { paymentOperations } from '@/db/schema/payments.js'
import { tenants } from '@/db/schema/tenants.js'
import { users } from '@/db/schema/users.js'
import { orders } from '@/db/schema/orders.js'
import {
  MOCK_BANK_AUTO_PAY_QUEUE_NAME,
  MockBankProvider,
  type MockBankAutoPayJobData,
} from '@/modules/payments/infrastructure/adapters/mock-bank.provider.js'
import { NotSupportedByProviderError } from '@/modules/payments/domain/errors/not-supported-by-provider.error.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const TEST_REDIS_URL = process.env.PAYMENTS_TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379'

const PROBE_TIMEOUT_MS = 1_500

/** Тот же приём, что `test/integration/orders/redis-cart-hold-store.adapter.integration.spec.ts` (DTJ-224). */
async function isRedisReachable(url: string): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: PROBE_TIMEOUT_MS, maxRetriesPerRequest: 1 })
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

const redisAvailable = await isRedisReachable(TEST_REDIS_URL)

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

function fakeConfig(mockBankAutoPayDelayMs: number): AppConfigService {
  const env: Partial<EnvConfig> = { MOCK_BANK_AUTO_PAY_DELAY_MS: mockBankAutoPayDelayMs }
  const configService = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

interface FakeQueue {
  add: ReturnType<typeof vi.fn>
}

describe.skipIf(!postgresAvailable)('MockBankProvider (DTJ-238)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let tenantId: string
  let customerId: string
  let orderId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  // Правило 5 AGENTS.md / приёмка: в БД не должно оставаться мусора этого сьюта. `orders`
  // удаляется ПЕРВЫМ (каскадом уносит свои `payment_operations`, FK `ON DELETE CASCADE`,
  // 0029_payments.sql), затем `users`/`tenants` (`orders.customer_id`/`tenant_id` — `ON DELETE
  // RESTRICT`, удаление users/tenants раньше orders упало бы с ошибкой FK).
  afterEach(async () => {
    await db.delete(orders).where(eq(orders.id, orderId))
    await db.delete(users).where(eq(users.id, customerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  beforeEach(async () => {
    tenantId = randomUUID()
    await db.insert(tenants).values({ id: tenantId, slug: `dtj238-${tenantId.slice(0, 8)}`, isNeutral: false })
    customerId = randomUUID()
    await db.insert(users).values({ id: customerId, tenantId, role: 'customer' })
    orderId = randomUUID()
    await db.insert(orders).values({
      id: orderId,
      orderNumber: `DTJ238-${randomUUID().slice(0, 8)}`,
      customerId,
      paymentMethod: 'alif_mobi',
      itemsTotalTjs: '10.00',
      deliveryFeeTjs: '0.00',
      totalAmountTjs: '10.00',
      deliveryAddress: 'x',
      tenantId,
      checkoutAttemptId: randomUUID(),
    })
  })

  describe('capabilities() — SRS-PAY-004 (без БД)', () => {
    it('отражает реалистичные ограничения mock_bank, не оптимистичный случай', () => {
      const provider = new MockBankProvider(db, { add: vi.fn() } as unknown as FakeQueue as never, fakeConfig(0))
      expect(provider.capabilities()).toEqual({
        providerName: 'mock_bank',
        supportsHoldCapture: false,
        supportsPartialRefund: false,
        maxInvoiceValidityMinutes: 15,
      })
    })
  })

  describe('createInvoice()', () => {
    it('создаёт payment_operations(create_bill, pending) и возвращает providerRef/qrPayload/expiresAt', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(2000))
      const idempotencyKey = `key-${randomUUID()}`

      const result = await provider.createInvoice({
        orderId,
        amountDiram: 100_000n,
        currency: 'TJS',
        idempotencyKey,
        description: 'test',
        customerPhone: '+992900000000',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.providerRef).toMatch(/^mock_inv_/)
      expect(result.value.qrPayload).toBe(`mock://pay/${result.value.providerRef}`)
      expect(result.value.expiresAt.getTime()).toBeGreaterThan(Date.now())

      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.operationType).toBe('create_bill')
      expect(rows[0]?.status).toBe('pending')
      expect(rows[0]?.provider).toBe('mock_bank')
      expect(rows[0]?.amountDiram).toBe(100_000n)
    })

    it('SRS-PAY-003: повторный вызов с тем же idempotencyKey НЕ создаёт вторую строку, возвращает СУЩЕСТВУЮЩИЙ providerRef', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(2000))
      const idempotencyKey = `key-${randomUUID()}`
      const cmd = {
        orderId,
        amountDiram: 5_000n,
        currency: 'TJS' as const,
        idempotencyKey,
        description: 'test',
        customerPhone: '+992900000000',
      }

      const first = await provider.createInvoice(cmd)
      const second = await provider.createInvoice(cmd)

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(second.value.providerRef).toBe(first.value.providerRef)

      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      expect(rows).toHaveLength(1)
    })

    it('MOCK_BANK_AUTO_PAY_DELAY_MS=2000 — планирует джобу с delay=2000 (AC1 DTJ-238)', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(2000))

      await provider.createInvoice({
        orderId,
        amountDiram: 1_000n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })

      expect(queue.add).toHaveBeenCalledTimes(1)
      const callArgs = queue.add.mock.calls[0] as unknown[]
      const jobData = callArgs[1] as { type: string; amountDiram: string }
      const options = callArgs[2] as { delay: number }
      expect(jobData.type).toBe('payment_confirmed')
      expect(jobData.amountDiram).toBe('1000')
      expect(options.delay).toBe(2000)
    })

    it('MOCK_BANK_AUTO_PAY_DELAY_MS=0 — НЕ планирует джобу (AC2 DTJ-238)', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(0))

      await provider.createInvoice({
        orderId,
        amountDiram: 1_000n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })

      expect(queue.add).not.toHaveBeenCalled()
    })
  })

  describe('getStatus()', () => {
    it('возвращает pending → status=pending, succeeded → status=paid', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(0))
      const created = await provider.createInvoice({
        orderId,
        amountDiram: 2_500n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const pendingStatus = await provider.getStatus(created.value.providerRef)
      expect(pendingStatus.ok).toBe(true)
      if (pendingStatus.ok) expect(pendingStatus.value.status).toBe('pending')

      await db
        .update(paymentOperations)
        .set({ status: 'succeeded' })
        .where(eq(paymentOperations.providerRef, created.value.providerRef))

      const paidStatus = await provider.getStatus(created.value.providerRef)
      expect(paidStatus.ok).toBe(true)
      if (paidStatus.ok) {
        expect(paidStatus.value.status).toBe('paid')
        expect(paidStatus.value.paidAt).not.toBeNull()
      }
    })

    it('неизвестный providerRef → Err(PROVIDER_REF_NOT_FOUND)', async () => {
      const provider = new MockBankProvider(db, { add: vi.fn() } as unknown as never, fakeConfig(0))
      const result = await provider.getStatus('mock_inv_does-not-exist')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('PROVIDER_REF_NOT_FOUND')
    })
  })

  describe('refund()', () => {
    it('синхронно успешен, создаёт payment_operations(refund, succeeded) с суммой оригинального инвойса', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(2000))
      const created = await provider.createInvoice({
        orderId,
        amountDiram: 7_777n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const refundIdempotencyKey = `refund-${randomUUID()}`
      const result = await provider.refund(created.value.providerRef, refundIdempotencyKey)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.status).toBe('succeeded')
      expect(result.value.amountDiram).toBe(7_777n)
      expect(result.value.providerRefundRef).toMatch(/^mock_refund_/)

      const rows = await db
        .select()
        .from(paymentOperations)
        .where(eq(paymentOperations.idempotencyKey, refundIdempotencyKey))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.operationType).toBe('refund')
      expect(rows[0]?.status).toBe('succeeded')
      expect(rows[0]?.orderId).toBe(orderId)

      // Эмулирует refund_confirmed через ту же delayed-джобу (SRS-PAY-004).
      const calls = queue.add.mock.calls as unknown[][]
      const refundJobCall = calls.find((call) => (call[1] as { type: string }).type === 'refund_confirmed')
      expect(refundJobCall).toBeDefined()
    })

    it('неизвестный providerRef → Err(PROVIDER_REF_NOT_FOUND)', async () => {
      const provider = new MockBankProvider(db, { add: vi.fn() } as unknown as never, fakeConfig(0))
      const result = await provider.refund('mock_inv_does-not-exist', `refund-${randomUUID()}`)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('PROVIDER_REF_NOT_FOUND')
    })
  })

  describe('partialRefund() — AC4 DTJ-238', () => {
    it('ВСЕГДА Err(NotSupportedByProviderError), без обращения к БД/очереди', async () => {
      const queue: FakeQueue = { add: vi.fn() }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(2000))

      const result = await provider.partialRefund('mock_inv_anything', 100n, 'idem-key')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(NotSupportedByProviderError)
        expect(result.error.code).toBe('NOT_SUPPORTED_BY_PROVIDER')
      }
      expect(queue.add).not.toHaveBeenCalled()
    })
  })

  describe('simulateWebhook() — dev-эндпоинт (DTJ-238 п.4)', () => {
    it('paid → enqueue payment_confirmed с delay=0 НЕЗАВИСИМО от mockBankAutoPayDelayMs', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(0))
      const created = await provider.createInvoice({
        orderId,
        amountDiram: 42n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      queue.add.mockClear()

      const result = await provider.simulateWebhook(created.value.providerRef, 'paid')

      expect(result.ok).toBe(true)
      expect(queue.add).toHaveBeenCalledTimes(1)
      const callArgs = queue.add.mock.calls[0] as unknown[]
      const jobData = callArgs[1] as { type: string }
      const options = callArgs[2] as { delay: number }
      expect(jobData.type).toBe('payment_confirmed')
      expect(options.delay).toBe(0)
    })

    it('failed → enqueue payment_failed', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(0))
      const created = await provider.createInvoice({
        orderId,
        amountDiram: 42n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })
      expect(created.ok).toBe(true)
      if (!created.ok) return
      queue.add.mockClear()

      await provider.simulateWebhook(created.value.providerRef, 'failed')

      const callArgs = queue.add.mock.calls[0] as unknown[]
      const jobData = callArgs[1] as { type: string }
      expect(jobData.type).toBe('payment_failed')
    })
  })

  describe('enqueueWebhookJob() — jobId формат (регрессия найденного дефекта, задача 1)', () => {
    it('jobId не содержит ":" ни для одной пары providerRef/type — явная проверка формата', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(2000))

      await provider.createInvoice({
        orderId,
        amountDiram: 1_000n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test',
        customerPhone: '+992900000000',
      })

      const callArgs = queue.add.mock.calls[0] as unknown[]
      const options = callArgs[2] as { jobId: string }
      expect(options.jobId).not.toContain(':')
      expect(options.jobId).toMatch(/^mock_inv_.+__payment_confirmed$/)
    })

    it('providerRef и type не склеиваются в неоднозначную строку — разные providerRef дают разные jobId', async () => {
      const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
      const provider = new MockBankProvider(db, queue as unknown as never, fakeConfig(2000))

      await provider.createInvoice({
        orderId,
        amountDiram: 1n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'x',
        customerPhone: '+992900000000',
      })
      await provider.createInvoice({
        orderId,
        amountDiram: 2n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'x',
        customerPhone: '+992900000000',
      })

      const firstJobId = (queue.add.mock.calls[0] as unknown[])[2] as { jobId: string }
      const secondJobId = (queue.add.mock.calls[1] as unknown[])[2] as { jobId: string }
      expect(firstJobId.jobId).not.toBe(secondJobId.jobId)
    })
  })

  describe.skipIf(!redisAvailable)('enqueueWebhookJob() — РЕАЛЬНЫЙ BullMQ/Redis (задача 1: дефект, не заглушка)', () => {
    let redis: Redis
    let queue: Queue<MockBankAutoPayJobData>
    const enqueuedJobIds: string[] = []

    beforeAll(() => {
      redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null })
      queue = new Queue<MockBankAutoPayJobData>(MOCK_BANK_AUTO_PAY_QUEUE_NAME, { connection: redis })
    })

    afterAll(async () => {
      await queue.close()
      redis.disconnect()
    })

    afterEach(async () => {
      for (const jobId of enqueuedJobIds.splice(0)) {
        const job = await queue.getJob(jobId)
        await job?.remove().catch(() => undefined)
      }
    })

    it('документирует сам дефект: реальный BullMQ отвергает jobId, содержащий ровно один ":"', async () => {
      const brokenJobId = 'ref-123:payment_confirmed'
      await expect(
        queue.add(
          MOCK_BANK_AUTO_PAY_QUEUE_NAME,
          { bankEventId: 'x', providerRef: 'ref-123', type: 'payment_confirmed', amountDiram: '100' },
          { jobId: brokenJobId },
        ),
      ).rejects.toThrow('Custom Id cannot contain :')
    })

    it('createInvoice() с ненулевой задержкой против РЕАЛЬНОГО BullMQ не бросает и планирует ровно одну джобу', async () => {
      const provider = new MockBankProvider(db, queue, fakeConfig(2000))

      const result = await provider.createInvoice({
        orderId,
        amountDiram: 55_500n,
        currency: 'TJS',
        idempotencyKey: `key-${randomUUID()}`,
        description: 'test — real bullmq',
        customerPhone: '+992900000000',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const expectedJobId = `${result.value.providerRef}__payment_confirmed`
      enqueuedJobIds.push(expectedJobId)

      const job = await queue.getJob(expectedJobId)
      expect(job).toBeDefined()
      expect(job?.data.type).toBe('payment_confirmed')
      expect(job?.opts.delay).toBe(2000)
    })
  })
})
