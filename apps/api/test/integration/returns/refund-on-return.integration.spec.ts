/**
 * `RefundOnReturnResolvedUseCase` × `PaymentsFacadeAdapter` — сквозной тест, РЕАЛЬНЫЙ Postgres +
 * Redis/BullMQ (харнесс — `domain-events-router.integration.spec.ts`). «Relay» (outbox → BullMQ)
 * — `apps/worker` (вне периметра этого тикета) — здесь смоделирован тем же маппингом, что
 * `OutboxRelayProcessor.toEnvelope`. `PAYMENTS_ORDERS_PORT` переопределён лёгким `TestOrdersPort`
 * (1:1 приём `refund-order.integration.spec.ts`) — полная реконструкция агрегата `Order` вне
 * периметра обоих тикетов.
 */
import { randomUUID, generateKeyPairSync } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Test, type TestingModule } from '@nestjs/testing'
import IORedis from 'ioredis'
import { Queue } from 'bullmq'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { and, eq } from 'drizzle-orm'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { isErr } from '@dorutj/domain-kernel'
import { escrowLedger, paymentOperations } from '@/db/schema/payments.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { orders as ordersTable } from '@/db/schema/orders.js'
import { OrderReturn, ReturnReason } from '@/modules/returns/domain/index.js'
import { ConfirmReturnReceivedUseCase } from '@/modules/returns/application/use-cases/confirm-return-received.use-case.js'
import { DrizzleReturnsRepository } from '@/modules/returns/infrastructure/repositories/drizzle-returns.repository.js'
import {
  PAYMENTS_ORDERS_PORT,
  type PaymentsOrdersPort,
  type PaymentsOrderSnapshot,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import {
  connect,
  isPostgresReachable,
  seedChain,
  seedMedicineWithInventory,
  seedOrder,
  seedOrderItem,
  seedPharmacy,
  seedTenant,
  seedUser,
  TEST_DATABASE_URL,
} from './returns-test.fixture.js'

const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380/0'
const PROBE_TIMEOUT_MS = 1_500
const WAIT_MARGIN_MS = 8_000
const TEST_TIMEOUT_MS = 25_000
const FIXED_NOW = new Date('2026-09-25T12:00:00.000Z')
const FAR_FUTURE_EXPIRY = new Date('2030-01-01T00:00:00.000Z')
const REFUND_AMOUNT_DIRAM = 5_000n // 50.00 TJS — совпадает с числом из AC1 тикета.
const ITEM_QUANTITY = 1

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
  OTP_RATE_LIMIT_KEY_PREFIX: 'test:otp_rl_refund_on_return',
  OTP_VERIFY_MAX_ATTEMPTS: '5',
  TELEGRAM_BOT_TOKEN_NEUTRAL: 'test-bot-token-for-refund-on-return',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  CART_HOLD_TTL_SECONDS: '900',
  PAYMENT_PROVIDER_TIMEOUT_MS: '8000',
  MOCK_BANK_AUTO_PAY_DELAY_MS: '0',
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

interface OutboxRow {
  readonly id: string
  readonly eventType: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly tenantId: string | null
  readonly payload: unknown
  readonly createdAt: Date
}

/** См. JSDoc файла — read-only `PaymentsOrdersPort` поверх общей Drizzle-схемы `orders`, 1:1 приём `refund-order.integration.spec.ts` (DTJ-245). */
class TestOrdersPort implements PaymentsOrdersPort {
  public constructor(private readonly db: NodePgDatabase) {}

  public async getOrderById(tenantId: string, orderId: string): Promise<PaymentsOrderSnapshot | null> {
    const rows = await this.db
      .select({
        id: ordersTable.id,
        tenantId: ordersTable.tenantId,
        pharmacyId: ordersTable.pharmacyId,
        status: ordersTable.status,
        paymentMethod: ordersTable.paymentMethod,
        totalAmountTjs: ordersTable.totalAmountTjs,
        billingStrategy: ordersTable.billingStrategy,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.tenantId, tenantId)))
      .limit(1)
    const row = rows[0]
    if (row?.status == null) return null
    return {
      id: row.id,
      tenantId: row.tenantId,
      pharmacyId: row.pharmacyId,
      status: row.status,
      paymentMethod: row.paymentMethod,
      totalAmountDiram: Money.fromDbDecimalTjs(row.totalAmountTjs).diram,
      pharmacyChainId: null,
      items: [], // RefundOrderUseCase не читает .items (см. её JSDoc / TestOrdersPort DTJ-245).
      billingStrategy: row.billingStrategy === 'split_items_delivery' ? 'split_items_delivery' : 'single_invoice',
    }
  }

  public markPaidEscrow(): Promise<void> {
    return Promise.reject(new Error('TestOrdersPort.markPaidEscrow: not needed by RefundOrderUseCase'))
  }

  public cancel(): Promise<void> {
    return Promise.reject(new Error('TestOrdersPort.cancel: not needed by RefundOrderUseCase'))
  }
}

/** Production-маппинг `apps/worker/src/jobs/outbox-relay/outbox-relay.processor.ts:toEnvelope` — см. JSDoc файла. */
function toEnvelope(row: OutboxRow): DomainEventEnvelope {
  return {
    eventId: row.id,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    tenantId: row.tenantId,
    occurredAt: row.createdAt.toISOString(),
    payload: row.payload as Record<string, unknown>,
  }
}

describe.skipIf(!postgresAvailable || !redisAvailable)('RefundOnReturnResolvedUseCase × PaymentsFacadeAdapter — integration (DTJ-285)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let moduleRef: TestingModule
  let domainEventsQueue: Queue
  let repository: DrizzleReturnsRepository
  let confirmReturnReceived: ConfirmReturnReceivedUseCase

  let tenantId: string
  let customerId: string
  let chainId: string
  let pharmacyId: string
  let orderId: string
  let medicineId: string

  beforeAll(async () => {
    applyRequiredTestEnv()
    ;({ pool, db } = connect())
    domainEventsQueue = new Queue('domain-events', { connection: new IORedis(TEST_REDIS_URL, { maxRetriesPerRequest: null }) })

    const { AppConfigModule } = await import('@/config/config.module.js')
    const { LoggerModule } = await import('@/common/logging/logger.module.js')
    const { SharedKernelModule } = await import('@/shared-kernel/shared-kernel.module.js')
    const { DatabaseModule } = await import('@/infrastructure/database/database.module.js')
    const { RedisModule } = await import('@/infrastructure/redis/redis.module.js')
    const { IdempotencyModule } = await import('@/common/idempotency/idempotency.module.js')
    const { DomainEventsModule } = await import('@/common/events/domain-events.module.js')
    const { ReturnsModule } = await import('@/modules/returns/returns.module.js')

    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggerModule, SharedKernelModule, DatabaseModule, RedisModule, IdempotencyModule, DomainEventsModule, ReturnsModule],
    })
      .overrideProvider(PAYMENTS_ORDERS_PORT)
      .useValue(new TestOrdersPort(db))
      .compile()
    await moduleRef.init()

    repository = new DrizzleReturnsRepository(db)
    confirmReturnReceived = moduleRef.get(ConfirmReturnReceivedUseCase)
  })

  afterAll(async () => {
    await domainEventsQueue.close()
    await pool.end().catch(() => undefined)
    await moduleRef.close()
  })

  afterEach(async () => {
    await pool.query('DELETE FROM escrow_ledger WHERE order_id = $1', [orderId]).catch(() => undefined)
    await pool.query('DELETE FROM payment_operations WHERE order_id = $1', [orderId]).catch(() => undefined)
    await pool.query(`DELETE FROM processed_events WHERE consumer_name = 'returns.on-resolved'`).catch(() => undefined)
    await pool.query('DELETE FROM outbox WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM orders WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_inventory WHERE medicine_id = $1', [medicineId]).catch(() => undefined)
    await pool.query('DELETE FROM medicines WHERE id = $1', [medicineId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId]).catch(() => undefined)
  })

  function parseReason(raw: string): ReturnReason {
    const result = ReturnReason.parse(raw)
    if (isErr(result)) throw result.error
    return result.value
  }

  /** Возврат сразу в `return_in_transit` — 1:1 приём `confirm-return-received.integration.spec.ts` (DTJ-273). */
  async function seedReturnInTransit(): Promise<string> {
    const requested = OrderReturn.request(
      { id: randomUUID(), orderId, reason: parseReason('defect'), initiatedBy: customerId, initiatorRole: 'customer', existingNonTerminalReturnIds: [] },
      FIXED_NOW,
    )
    requested.markInTransit(customerId, Money.fromDiram(1_000n))
    await repository.save(requested)
    return requested.id
  }

  /** Заводит tenant/pharmacy/chain/customer/order/order_items/medicine+inventory — non-cash заказ, single_invoice, total=REFUND_AMOUNT_DIRAM. */
  async function setupNonCashOrder(): Promise<void> {
    tenantId = await seedTenant(db)
    customerId = await seedUser(db, tenantId, 'customer')
    chainId = await seedChain(db)
    pharmacyId = await seedPharmacy(db, chainId)
    orderId = await seedOrder(db, {
      tenantId,
      customerId,
      pharmacyId,
      status: 'delivered',
      paymentMethod: 'alif_mobi',
      billingStrategy: 'single_invoice',
      deliveredAt: FIXED_NOW,
    })
    await pool.query(`UPDATE orders SET items_total_tjs = '50.00', delivery_fee_tjs = '0.00', total_amount_tjs = '50.00' WHERE id = $1`, [orderId])
    const medicine = await seedMedicineWithInventory({ db, pharmacyId, expiresAt: FAR_FUTURE_EXPIRY, initialQuantity: 5 })
    medicineId = medicine.medicineId
    await seedOrderItem({ db, orderId, medicineId, inventoryBatchId: medicine.inventoryBatchId, quantity: ITEM_QUANTITY })
  }

  /** См. JSDoc `refund-order.integration.spec.ts` `seedHold` (DTJ-245) — `MockBankProvider.refund()` резолвит счёт через `payment_operations.provider_ref`, голой строки `escrow_ledger` недостаточно. */
  async function seedHold(providerRef: string): Promise<void> {
    await db.insert(paymentOperations).values({
      orderId,
      operationType: 'create_bill',
      idempotencyKey: `invoice:${orderId}:${randomUUID()}`,
      provider: 'mock_bank',
      providerRef,
      status: 'succeeded',
      amountDiram: REFUND_AMOUNT_DIRAM,
    })
    await db.insert(escrowLedger).values({
      orderId,
      entryType: 'hold_created',
      direction: 'debit',
      amountDiram: REFUND_AMOUNT_DIRAM,
      paymentTransactionRef: providerRef,
    })
  }

  async function readOutboxRow(returnId: string): Promise<OutboxRow> {
    const rows = await db
      .select()
      .from(outbox)
      .where(and(eq(outbox.aggregateId, returnId), eq(outbox.eventType, 'ReturnConfirmedEvent')))
      .limit(1)
    const row = rows[0]
    if (row === undefined) throw new Error(`readOutboxRow: no ReturnConfirmedEvent outbox row for return ${returnId}`)
    return row
  }

  async function countProcessedEvents(eventId: string): Promise<number> {
    const result = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM processed_events WHERE consumer_name = 'returns.on-resolved' AND event_id = $1`,
      [eventId],
    )
    return result.rows[0]?.n ?? 0
  }

  it(
    'AC1 — paid_escrow (non-cash), возврат подтверждён на 5000 диримов: escrow_ledger получает refunded_to_customer=5000, провайдер вызван',
    async () => {
      await setupNonCashOrder()
      await seedHold(`mock_inv_${randomUUID()}`)
      const returnId = await seedReturnInTransit()

      const result = await confirmReturnReceived.execute({ tenantId, returnId, checklist: { packagingIntact: true } })
      expect(result.disposition).toBe('restock') // reason=defect + restock-eligible → FULL_REFUND (см. ReturnFinancialOutcomeResolver).

      const outboxRow = await readOutboxRow(returnId)
      await domainEventsQueue.add(outboxRow.eventType, toEnvelope(outboxRow), { jobId: outboxRow.id })

      await expect
        .poll(
          async () => {
            const rows = await db
              .select()
              .from(escrowLedger)
              .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
            return rows.length
          },
          { timeout: WAIT_MARGIN_MS, interval: 100 },
        )
        .toBe(1)

      const refundRows = await db
        .select()
        .from(escrowLedger)
        .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
      expect(refundRows[0]?.amountDiram).toBe(REFUND_AMOUNT_DIRAM)
      expect(refundRows[0]?.direction).toBe('credit')

      const refundOps = await db
        .select()
        .from(paymentOperations)
        .where(and(eq(paymentOperations.orderId, orderId), eq(paymentOperations.operationType, 'refund')))
      expect(refundOps).toHaveLength(1) // провайдер (MockBankProvider) реально вызван — не noop.
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'AC2 — повторная доставка ТОГО ЖЕ outbox-события (другой BullMQ jobId, тот же eventId) — второго рефанда/второй записи ledger нет',
    async () => {
      await setupNonCashOrder()
      await seedHold(`mock_inv_${randomUUID()}`)
      const returnId = await seedReturnInTransit()
      await confirmReturnReceived.execute({ tenantId, returnId, checklist: { packagingIntact: true } })
      const outboxRow = await readOutboxRow(returnId)

      await domainEventsQueue.add(outboxRow.eventType, toEnvelope(outboxRow), { jobId: outboxRow.id })
      await expect.poll(() => countProcessedEvents(outboxRow.id), { timeout: WAIT_MARGIN_MS, interval: 100 }).toBe(1)

      // Повторная доставка — та же логическая eventId (outbox.id), другой BullMQ jobId
      // (SRS-DOM-152 at-least-once: dedup идёт по eventId в processed_events, не по jobId).
      await domainEventsQueue.add(outboxRow.eventType, toEnvelope(outboxRow), { jobId: `${outboxRow.id}-redelivery` })
      await new Promise((resolve) => setTimeout(resolve, 1_000))

      expect(await countProcessedEvents(outboxRow.id)).toBe(1)
      const refundRows = await db
        .select()
        .from(escrowLedger)
        .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
      expect(refundRows).toHaveLength(1)
      const refundOps = await db
        .select()
        .from(paymentOperations)
        .where(and(eq(paymentOperations.orderId, orderId), eq(paymentOperations.operationType, 'refund')))
      expect(refundOps).toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'AC3 — заказ cash_courier: возврат подтверждён, PaymentsPort НЕ вызывается, escrow_ledger заказа пуст (ветка без движения денег, D-25)',
    async () => {
      await setupNonCashOrder() // переиспользуем сидинг тенанта/аптеки/товара, ниже переводим заказ на cash_courier.
      await pool.query(`UPDATE orders SET payment_method = 'cash_courier' WHERE id = $1`, [orderId])
      const returnId = await seedReturnInTransit()

      await confirmReturnReceived.execute({ tenantId, returnId, checklist: { packagingIntact: true } })
      const outboxRow = await readOutboxRow(returnId)
      await domainEventsQueue.add(outboxRow.eventType, toEnvelope(outboxRow), { jobId: outboxRow.id })

      await expect.poll(() => countProcessedEvents(outboxRow.id), { timeout: WAIT_MARGIN_MS, interval: 100 }).toBe(1)

      const refundRows = await db.select().from(escrowLedger).where(eq(escrowLedger.orderId, orderId))
      expect(refundRows).toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )
})
