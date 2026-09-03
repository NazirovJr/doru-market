/**
 * `CreatePaymentInvoiceUseCase` (EP-10, DTJ-241, тест-план тикета) — РЕАЛЬНЫЙ Postgres (тот же
 * приём, что `mock-bank.provider.integration.spec.ts`, DTJ-238: конструирует зависимости
 * напрямую `new`, не через `Test.createTestingModule` — избегает `AppConfigModule`-кэша
 * `ConfigService` (foundIssue, см. JSDoc `test-app.ts` «fakeMockBankAutoPayQueue»), быстрее и
 * проще для чистого application-теста).
 *
 * AC1 DTJ-241 — последовательный повтор с ОДНИМ `idempotencyKey`: `PaymentProvider.createInvoice`
 * вызван РОВНО один раз (счётчик мока), оба вызова возвращают ОДИН И ТОТ ЖЕ `InvoiceRef`.
 *
 * **Идемпотентность под РЕАЛЬНОЙ конкурентностью (`Promise.all`, не мок)** — отдельный раздел
 * ниже, требование «Сдача» top-level задания: два ОДНОВРЕМЕННЫХ `execute()` с ОДНИМ
 * `idempotencyKey` против настоящего `MockBankProvider`+Postgres не порождают ВТОРОЙ счёт у
 * провайдера — `payment_operations` содержит РОВНО одну строку для этого `idempotencyKey`
 * (атомарная гарантия `MockBankProvider.insertOrReuseOperation`, DTJ-238, `ON CONFLICT DO
 * NOTHING`), НЕЗАВИСИМО от того, сколько раз МЕТОД провайдера был вызван (см. DISPUTED в отчёте
 * сдачи — `CreatePaymentInvoiceUseCase`'s собственный кэш — SELECT, не атомарный INSERT, чтобы
 * не конфликтовать с УЖЕ существующей идемпотентностью `MockBankProvider`).
 *
 * Также доказывает АРХИТЕКТУРНУЮ СОВМЕСТИМОСТЬ портов `orders`↔`payments`: `PaymentInvoiceAdapter`
 * (реализация `orders`-порта) корректно делегирует В ЭТОТ use case и обратно маппирует Result —
 * см. отдельный набор `payment-invoice-adapter.spec.ts` (unit) + сквозной прогон через
 * `CheckoutUseCase` в `checkout-payment-invoice-port-compat.integration.spec.ts`.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import type { ConfigService } from '@nestjs/config'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { paymentOperations } from '@/db/schema/payments.js'
import { tenants } from '@/db/schema/tenants.js'
import { users } from '@/db/schema/users.js'
import { orders } from '@/db/schema/orders.js'
import { MockBankProvider } from '@/modules/payments/infrastructure/adapters/mock-bank.provider.js'
import { DrizzlePaymentInvoiceCacheRepository } from '@/modules/payments/infrastructure/repositories/drizzle-payment-invoice-cache.repository.js'
import { CreatePaymentInvoiceUseCase } from '@/modules/payments/application/use-cases/create-payment-invoice.use-case.js'
import type { CreateInvoiceCommand, PaymentProvider } from '@/modules/payments/application/ports/payment-provider.port.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500

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

function fakeConfig(): AppConfigService {
  const env: Partial<EnvConfig> = { MOCK_BANK_AUTO_PAY_DELAY_MS: 0, PAYMENT_PROVIDER_TIMEOUT_MS: 8_000 }
  const configService = { get: (key: keyof EnvConfig) => env[key] } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

interface FakeQueue {
  add: ReturnType<typeof vi.fn>
}

describe.skipIf(!postgresAvailable)('CreatePaymentInvoiceUseCase (DTJ-241)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let tenantId: string
  let customerId: string
  let orderId: string
  let mockProvider: MockBankProvider
  let providerCreateInvoiceSpy: ReturnType<typeof vi.spyOn>
  let useCase: CreatePaymentInvoiceUseCase

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.id, orderId))
    await db.delete(users).where(eq(users.id, customerId))
    await db.delete(tenants).where(eq(tenants.id, tenantId))
  })

  beforeEach(async () => {
    tenantId = randomUUID()
    await db.insert(tenants).values({ id: tenantId, slug: `dtj241-${tenantId.slice(0, 8)}`, isNeutral: false })
    customerId = randomUUID()
    await db.insert(users).values({ id: customerId, tenantId, role: 'customer' })
    orderId = randomUUID()
    await db.insert(orders).values({
      id: orderId,
      orderNumber: `DTJ241-${randomUUID().slice(0, 8)}`,
      customerId,
      paymentMethod: 'alif_mobi',
      itemsTotalTjs: '10.00',
      deliveryFeeTjs: '0.00',
      totalAmountTjs: '10.00',
      deliveryAddress: 'x',
      tenantId,
      checkoutAttemptId: randomUUID(),
    })

    const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
    mockProvider = new MockBankProvider(db, queue as unknown as never, fakeConfig())
    providerCreateInvoiceSpy = vi.spyOn(mockProvider, 'createInvoice')
    const cache = new DrizzlePaymentInvoiceCacheRepository(db)
    useCase = new CreatePaymentInvoiceUseCase(mockProvider, cache, fakeConfig())
  })

  function buildCmd(idempotencyKey: string): CreateInvoiceCommand {
    return {
      orderId,
      amountDiram: 1_000n,
      currency: 'TJS',
      idempotencyKey,
      description: 'test',
      customerPhone: '+992900000000',
    }
  }

  it('AC1 — повторный вызов с ОДНИМ idempotencyKey: provider.createInvoice вызван РОВНО один раз, оба вызова — один InvoiceRef', async () => {
    const idempotencyKey = `key-${randomUUID()}`

    const first = await useCase.execute(buildCmd(idempotencyKey))
    const second = await useCase.execute(buildCmd(idempotencyKey))

    expect(providerCreateInvoiceSpy).toHaveBeenCalledTimes(1)
    expect(second.providerRef).toBe(first.providerRef)
    expect(second.qrPayload).toBe(first.qrPayload)
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime())

    const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.qrPayload).toBe(first.qrPayload)
    expect(rows[0]?.expiresAt?.getTime()).toBe(first.expiresAt.getTime())
  })

  it('AC2 — ошибка провайдера пробрасывается вызывающему коду (не проглатывается)', async () => {
    const failingProvider: PaymentProvider = {
      capabilities: () => mockProvider.capabilities(),
      createInvoice: () =>
        Promise.resolve({ ok: false, error: new PaymentProviderError('SIMULATED_ADAPTER_FAILURE', 'simulated adapter failure') }),
      getStatus: mockProvider.getStatus.bind(mockProvider),
      refund: mockProvider.refund.bind(mockProvider),
      partialRefund: mockProvider.partialRefund.bind(mockProvider),
    }
    const cache = new DrizzlePaymentInvoiceCacheRepository(db)
    const failingUseCase = new CreatePaymentInvoiceUseCase(failingProvider, cache, fakeConfig())

    await expect(failingUseCase.execute(buildCmd(`key-${randomUUID()}`))).rejects.toThrow(/simulated adapter failure/)

    const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.orderId, orderId))
    expect(rows).toHaveLength(0)
  })

  describe('Идемпотентность под РЕАЛЬНОЙ конкурентностью (Promise.all, не мок)', () => {
    it('два ОДНОВРЕМЕННЫХ execute() с ОДНИМ idempotencyKey → РОВНО одна строка payment_operations (не второй счёт у провайдера)', async () => {
      const idempotencyKey = `key-${randomUUID()}`

      const [first, second] = await Promise.all([
        useCase.execute(buildCmd(idempotencyKey)),
        useCase.execute(buildCmd(idempotencyKey)),
      ])

      expect(first.providerRef).toBe(second.providerRef)

      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      expect(rows).toHaveLength(1)
    })

    it('десять ОДНОВРЕМЕННЫХ execute() с ОДНИМ idempotencyKey → всё равно РОВНО одна строка', async () => {
      const idempotencyKey = `key-${randomUUID()}`
      const CONCURRENT_CALLS = 10

      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CALLS }, () => useCase.execute(buildCmd(idempotencyKey))),
      )

      const distinctProviderRefs = new Set(results.map((r) => r.providerRef))
      expect(distinctProviderRefs.size).toBe(1)

      const rows = await db.select().from(paymentOperations).where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      expect(rows).toHaveLength(1)
    })
  })
})
