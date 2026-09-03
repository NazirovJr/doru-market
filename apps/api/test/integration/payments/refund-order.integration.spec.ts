/**
 * `RefundOrderUseCase`/`RefundFacadeAdapter` (EP-10, DTJ-245) — РЕАЛЬНЫЙ Postgres + реальный
 * `MockBankProvider` (DTJ-238), тот же приём подключения/пробы, что
 * `create-payment-invoice.integration.spec.ts` (ближайший прецедент этого каталога).
 * Testcontainers не используется (D-EP09-14/31).
 *
 * `PaymentsOrdersPort` — МИНИМАЛЬНАЯ тестовая реализация (`TestOrdersPort` ниже) — НЕ полная
 * обвязка `OrdersFacade`/`DrizzleOrderRepository`: та живёт в `orders`-модуле, а payments-тест,
 * читающий её напрямую, сам стал бы межмодульным deep-import'ом (`no-cross-module-deep-import`).
 * `TestOrdersPort` читает ТОЛЬКО общую Drizzle-схему (`@/db/schema/orders.js`) — тот же приём,
 * что `OrdersReadOnlyAdapter` использует.
 *
 * Доказывает ГЛАВНОЕ требование раздела «Сдача» top-level задания: повторный возврат по тому
 * же заказу не пишет вторую запись в `escrow_ledger` — включая РЕАЛЬНУЮ конкурентность
 * (`Promise.all`), не только последовательный повтор. Сериализация — частичный уникальный
 * индекс `ux_escrow_ledger_refunded_once` (`0035_escrow_ledger_refund_unique.sql`), НЕ
 * лок/транзакция уровня приложения — см. JSDoc `refund-order.use-case.ts` «Решение — частичный
 * уникальный индекс» (первая версия с `pg_advisory_xact_lock`/`SELECT ... FOR UPDATE` вокруг
 * `PaymentProvider.refund()` воспроизводила исчерпание пула соединений под 10 конкурентными
 * вызовами — найдено ИМЕННО этим прогоном, см. историю файла). Под ИСТИННОЙ одновременностью
 * `PaymentProvider.refund()` может быть вызван БОЛЬШЕ одного раза (оба гонщика проходят
 * pre-check до того, как любой записал ledger) — это ОЖИДАЕМО и безопасно: `MockBankProvider`
 * сам гарантирует `payment_operations` РОВНО одну строку (`ON CONFLICT DO NOTHING`, DTJ-238),
 * тот же класс гарантии, что уже принят `CreatePaymentInvoiceUseCase`
 * (`create-payment-invoice.integration.spec.ts` тоже не утверждает «вызван один раз» под
 * `Promise.all`, только «одна строка `payment_operations`») — поэтому тесты конкурентности
 * ниже проверяют СТРОКИ в БД (`escrow_ledger`/`payment_operations`), не счётчик мока.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { ConfigService } from '@nestjs/config'
import { ErrorCode } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { orders } from '@/db/schema/orders.js'
import { tenants } from '@/db/schema/tenants.js'
import { users } from '@/db/schema/users.js'
import { pharmacies } from '@/db/schema/pharmacies.js'
import { escrowLedger, paymentOperations, payoutSchedule } from '@/db/schema/payments.js'
import { MockBankProvider } from '@/modules/payments/infrastructure/adapters/mock-bank.provider.js'
import { DrizzleEscrowLedgerRepository } from '@/modules/payments/infrastructure/repositories/escrow-ledger.repository.js'
import { DrizzlePayoutScheduleRepository } from '@/modules/payments/infrastructure/repositories/payout-schedule.repository.js'
import { RefundOrderUseCase } from '@/modules/payments/application/use-cases/refund-order.use-case.js'
import { RefundFacadeAdapter } from '@/modules/payments/infrastructure/adapters/refund-facade.adapter.js'
import type { PaymentsOrderSnapshot, PaymentsOrdersPort } from '@/modules/payments/application/ports/orders-facade.port.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const HOLD_AMOUNT_DIRAM = 10_000n

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

interface OrderRow {
  readonly id: string
  readonly tenantId: string
  readonly pharmacyId: string | null
  readonly status: string | null
  readonly paymentMethod: string
  readonly totalAmountTjs: string
}

/** См. JSDoc файла — минимальный read-only `PaymentsOrdersPort` поверх общей Drizzle-схемы. */
class TestOrdersPort implements PaymentsOrdersPort {
  public constructor(private readonly db: NodePgDatabase) {}

  public async getOrderById(tenantId: string, orderId: string): Promise<PaymentsOrderSnapshot | null> {
    const rows = await this.db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        pharmacyId: orders.pharmacyId,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        totalAmountTjs: orders.totalAmountTjs,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return toSnapshot(row)
  }

  public markPaidEscrow(): Promise<void> {
    return Promise.reject(new Error('TestOrdersPort.markPaidEscrow: not needed by RefundOrderUseCase'))
  }

  public cancel(): Promise<void> {
    return Promise.reject(new Error('TestOrdersPort.cancel: not needed by RefundOrderUseCase'))
  }
}

function toSnapshot(row: OrderRow): PaymentsOrderSnapshot {
  if (row.status === null) throw new Error(`orders.status is NULL for order ${row.id}`)
  return {
    id: row.id,
    tenantId: row.tenantId,
    pharmacyId: row.pharmacyId,
    status: row.status,
    paymentMethod: row.paymentMethod,
    totalAmountDiram: Money.fromDbDecimalTjs(row.totalAmountTjs).diram,
    pharmacyChainId: null,
    items: [], // DTJ-244 — не нужно RefundOrderUseCase (не читает .items).
  }
}

describe.skipIf(!postgresAvailable)('RefundOrderUseCase/RefundFacadeAdapter — integration (DTJ-245)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let mockProvider: MockBankProvider
  let providerRefundSpy: ReturnType<typeof vi.spyOn>
  let refundFacadeAdapter: RefundFacadeAdapter
  let tenantId: string
  let customerId: string
  let orderId: string
  let cashOrderId: string
  let createdOrderIds: string[]

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  function nextOrderNumber(): string {
    return `DTJ245-${randomUUID().slice(0, 8)}`
  }

  async function seedOrder(paymentMethod: string, status: 'cancelled' | 'confirmed'): Promise<string> {
    const id = randomUUID()
    await db.insert(orders).values({
      id,
      orderNumber: nextOrderNumber(),
      customerId,
      paymentMethod,
      status,
      itemsTotalTjs: '100.00',
      deliveryFeeTjs: '0.00',
      totalAmountTjs: '100.00',
      deliveryAddress: 'Dushanbe, test str. 1',
      tenantId,
      checkoutAttemptId: randomUUID(),
    })
    createdOrderIds.push(id)
    return id
  }

  /**
   * `MockBankProvider.refund()` looks up the original charge via `payment_operations.
   * provider_ref` (`findOriginalInvoice`) — a bare `escrow_ledger.hold_created` row is not
   * enough on its own; a real `createInvoice()` call would have inserted this row too.
   */
  async function seedHold(forOrderId: string, providerRef: string, amountDiram = HOLD_AMOUNT_DIRAM): Promise<void> {
    await db.insert(paymentOperations).values({
      orderId: forOrderId,
      operationType: 'create_bill',
      idempotencyKey: `invoice:${forOrderId}:${randomUUID()}`,
      provider: 'mock_bank',
      providerRef,
      status: 'succeeded',
      amountDiram,
    })
    await db.insert(escrowLedger).values({
      orderId: forOrderId,
      entryType: 'hold_created',
      direction: 'debit',
      amountDiram,
      paymentTransactionRef: providerRef,
    })
  }

  beforeEach(async () => {
    createdOrderIds = []
    tenantId = randomUUID()
    await db.insert(tenants).values({ id: tenantId, slug: `dtj245-${tenantId.slice(0, 8)}`, isNeutral: false })
    customerId = randomUUID()
    await db.insert(users).values({ id: customerId, tenantId, role: 'customer' })
    orderId = await seedOrder('alif_mobi', 'cancelled')
    cashOrderId = await seedOrder('cash_courier', 'confirmed')

    const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined) }
    mockProvider = new MockBankProvider(db, queue as unknown as never, fakeConfig())
    providerRefundSpy = vi.spyOn(mockProvider, 'refund')

    const escrowRepo = new DrizzleEscrowLedgerRepository(db)
    const payoutRepo = new DrizzlePayoutScheduleRepository(db)
    const ordersPort = new TestOrdersPort(db)
    const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger
    const useCase = new RefundOrderUseCase(ordersPort, mockProvider, escrowRepo, payoutRepo, silentLogger)
    refundFacadeAdapter = new RefundFacadeAdapter(db, useCase)
  })

  afterEach(async () => {
    await db.delete(escrowLedger).where(eq(escrowLedger.orderId, orderId)).catch(() => undefined)
    await db.delete(payoutSchedule).where(eq(payoutSchedule.orderId, orderId)).catch(() => undefined)
    await db.delete(paymentOperations).where(eq(paymentOperations.orderId, orderId)).catch(() => undefined)
    await db.delete(orders).where(eq(orders.id, orderId)).catch(() => undefined)
    await db.delete(orders).where(eq(orders.id, cashOrderId)).catch(() => undefined)
    await db.delete(users).where(eq(users.id, customerId)).catch(() => undefined)
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined)
  })

  it('AC1 — non-cash, hold_created=10000: refund() вызван один раз, escrow_ledger получает refunded_to_customer=10000', async () => {
    await seedHold(orderId, `mock_inv_${randomUUID()}`)

    const result = await refundFacadeAdapter.refundFull(orderId, 'customer_changed_mind')

    expect(result.ok).toBe(true)
    expect(providerRefundSpy).toHaveBeenCalledTimes(1)
    const rows = await db.select().from(escrowLedger).where(eq(escrowLedger.orderId, orderId))
    const refundRows = rows.filter((r) => r.entryType === 'refunded_to_customer')
    expect(refundRows).toHaveLength(1)
    expect(refundRows[0]?.amountDiram).toBe(HOLD_AMOUNT_DIRAM)
    expect(refundRows[0]?.direction).toBe('credit')
  })

  it('несуществующий orderId → refundFull возвращает Err (не бросает), PAYMENT_PROVIDER_UNAVAILABLE', async () => {
    const result = await refundFacadeAdapter.refundFull(randomUUID(), 'customer_changed_mind')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)
      expect(result.error.message).toMatch(/not found/)
    }
  })

  it('AC2 — cash_courier: PaymentProvider.refund НЕ вызван, escrow_ledger не изменён', async () => {
    const result = await refundFacadeAdapter.refundFull(cashOrderId, 'customer_changed_mind')

    expect(result.ok).toBe(true)
    expect(providerRefundSpy).not.toHaveBeenCalled()
    const rows = await db.select().from(escrowLedger).where(eq(escrowLedger.orderId, cashOrderId))
    expect(rows).toHaveLength(0)
  })

  it('AC3 — последовательный повторный вызов: PaymentProvider.refund вызван РОВНО один раз, escrow_ledger — одна строка', async () => {
    await seedHold(orderId, `mock_inv_${randomUUID()}`)

    const first = await refundFacadeAdapter.refundFull(orderId, 'customer_changed_mind')
    const second = await refundFacadeAdapter.refundFull(orderId, 'customer_changed_mind')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(providerRefundSpy).toHaveBeenCalledTimes(1)
    const rows = await db
      .select()
      .from(escrowLedger)
      .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
    expect(rows).toHaveLength(1)
  })

  it('AC4 — payout_schedule уже существует → status переводится в reversed', async () => {
    await seedHold(orderId, `mock_inv_${randomUUID()}`)
    const pharmacyId = randomUUID()
    await db.insert(pharmacies).values({
      id: pharmacyId,
      name: 'DTJ-245 Test Pharmacy',
      addressText: 'Dushanbe, test str. 2',
      latitude: '38.5598',
      longitude: '68.7870',
      phone: '+992900000002',
    })
    await db.insert(payoutSchedule).values({
      orderId,
      pharmacyId,
      status: 'pending',
      grossAmountDiram: HOLD_AMOUNT_DIRAM,
      commissionDiram: 0n,
      netAmountDiram: HOLD_AMOUNT_DIRAM,
      holdPeriodDays: 3,
    })

    const result = await refundFacadeAdapter.refundFull(orderId, 'customer_changed_mind')

    expect(result.ok).toBe(true)
    const rows = await db.select().from(payoutSchedule).where(eq(payoutSchedule.orderId, orderId))
    expect(rows[0]?.status).toBe('reversed')
    await db.delete(payoutSchedule).where(eq(payoutSchedule.orderId, orderId)).catch(() => undefined)
    await db.delete(pharmacies).where(eq(pharmacies.id, pharmacyId)).catch(() => undefined)
  })

  describe('Идемпотентность под РЕАЛЬНОЙ конкурентностью (Promise.all, не мок)', () => {
    it('два ОДНОВРЕМЕННЫХ refundFull() с ОДНИМ orderId → PaymentProvider.refund вызван РОВНО один раз, escrow_ledger — одна строка refunded_to_customer', async () => {
      await seedHold(orderId, `mock_inv_${randomUUID()}`)

      const [first, second] = await Promise.all([
        refundFacadeAdapter.refundFull(orderId, 'customer_changed_mind'),
        refundFacadeAdapter.refundFull(orderId, 'customer_changed_mind'),
      ])

      // См. JSDoc файла: под ИСТИННОЙ одновременностью providerRefundSpy МОЖЕТ быть вызван
      // больше одного раза (оба гонщика проходят pre-check до первой записи в ledger) — это
      // ожидаемо и безопасно, проверяем СТРОКИ, не счётчик мока (тот же класс проверки, что
      // `create-payment-invoice.integration.spec.ts`).
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(providerRefundSpy).toHaveBeenCalled()
      const rows = await db
        .select()
        .from(escrowLedger)
        .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
      expect(rows).toHaveLength(1)
      const refundOps = await db
        .select()
        .from(paymentOperations)
        .where(and(eq(paymentOperations.orderId, orderId), eq(paymentOperations.operationType, 'refund')))
      expect(refundOps).toHaveLength(1)
    })

    it('десять ОДНОВРЕМЕННЫХ refundFull() с ОДНИМ orderId → всё равно РОВНО одна строка refunded_to_customer', async () => {
      await seedHold(orderId, `mock_inv_${randomUUID()}`)
      const CONCURRENT_CALLS = 10

      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CALLS }, () => refundFacadeAdapter.refundFull(orderId, 'customer_changed_mind')),
      )

      expect(results.every((r) => r.ok)).toBe(true)
      const rows = await db
        .select()
        .from(escrowLedger)
        .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
      expect(rows).toHaveLength(1)
    })
  })
})
