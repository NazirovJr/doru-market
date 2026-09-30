import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { TestingModule } from '@nestjs/testing'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { orders } from '@/db/schema/orders.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { escrowLedger, paymentOperations } from '@/db/schema/payments.js'
import { RefundOnOrderCancelledDomainEventHandler } from '@/modules/orders/application/order-lifecycle/refund-on-order-cancelled.domain-event-handler.js'
import { AdminForceCancelOrderUseCase } from '@/modules/admin/application/use-cases/admin-force-cancel-order.use-case.js'
import { SystemCancelOrderUseCase } from '@/modules/orders/application/order-lifecycle/system-cancel-order.use-case.js'
import { CancelPharmacyIncompleteOrdersUseCase } from '@/modules/orders/application/order-lifecycle/cancel-pharmacy-incomplete-orders.use-case.js'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProvider } from '@/modules/payments/application/ports/payment-provider.port.js'
import { bootAppModule } from '../common/__tests__/app-module-boot.js'
import {
  canonicalOrderNumber,
  cleanupMedicine,
  cleanupPharmacy,
  cleanupTenant,
  connect,
  isPostgresReachable,
  seedMedicineWithInventory,
  seedOrder,
  seedOrderItem,
  seedPharmacy,
  seedTenant,
  seedUser,
  TEST_DATABASE_URL,
} from '../returns/returns-test.fixture.js'

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)
const HOLD_AMOUNT_DIRAM = 6_000n

describe.skipIf(!postgresAvailable)('Отмена заказа: рефанд доводится обработчиком outbox — integration', () => {
  let pool: Pool
  let db: NodePgDatabase
  let app: TestingModule
  let provider: PaymentProvider
  let systemCancel: SystemCancelOrderUseCase
  let adminForceCancel: AdminForceCancelOrderUseCase
  let cancelPharmacyOrders: CancelPharmacyIncompleteOrdersUseCase
  let handler: RefundOnOrderCancelledDomainEventHandler

  let tenantId: string
  let pharmacyId: string
  let medicineId: string
  let orderId: string

  beforeAll(async () => {
    ;({ pool, db } = connect())
    app = await bootAppModule()
    provider = app.get<PaymentProvider>(PAYMENT_PROVIDER_TOKEN, { strict: false })
    systemCancel = app.get(SystemCancelOrderUseCase, { strict: false })
    adminForceCancel = app.get(AdminForceCancelOrderUseCase, { strict: false })
    cancelPharmacyOrders = app.get(CancelPharmacyIncompleteOrdersUseCase, { strict: false })
    handler = app.get(RefundOnOrderCancelledDomainEventHandler, { strict: false })
  }, 60_000)

  afterAll(async () => {
    await app.close()
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await db.delete(escrowLedger).where(eq(escrowLedger.orderId, orderId)).catch(() => undefined)
    await db.delete(paymentOperations).where(eq(paymentOperations.orderId, orderId)).catch(() => undefined)
    await db.delete(outbox).where(eq(outbox.tenantId, tenantId)).catch(() => undefined)
    await cleanupTenant(db, tenantId)
    await cleanupMedicine(db, medicineId)
    await cleanupPharmacy(db, pharmacyId)
  })

  async function seedPaidOrder(): Promise<void> {
    tenantId = await seedTenant(db)
    const customerId = await seedUser(db, tenantId, 'customer')
    pharmacyId = await seedPharmacy(db)
    const stock = await seedMedicineWithInventory({ db, pharmacyId, expiresAt: new Date(Date.now() + 365 * 24 * 3_600_000) })
    medicineId = stock.medicineId
    orderId = await seedOrder(db, {
      tenantId,
      customerId,
      pharmacyId,
      status: 'paid_escrow',
      paymentMethod: 'alif_mobi',
      orderNumber: canonicalOrderNumber(),
    })
    await seedOrderItem({ db, orderId, medicineId, inventoryBatchId: stock.inventoryBatchId, quantity: 1 })
    const providerRef = `mock_inv_${randomUUID()}`
    await db.insert(paymentOperations).values({
      orderId,
      operationType: 'create_bill',
      idempotencyKey: `invoice:${orderId}:${randomUUID()}`,
      provider: 'mock_bank',
      providerRef,
      status: 'succeeded',
      amountDiram: HOLD_AMOUNT_DIRAM,
    })
    await db.insert(escrowLedger).values({
      orderId,
      entryType: 'hold_created',
      direction: 'debit',
      amountDiram: HOLD_AMOUNT_DIRAM,
      paymentTransactionRef: providerRef,
    })
  }

  async function refundRows(): Promise<number> {
    const rows = await db
      .select({ id: escrowLedger.id })
      .from(escrowLedger)
      .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
    return rows.length
  }

  async function cancelledEnvelope(): Promise<DomainEventEnvelope> {
    const [row] = await db.select().from(outbox).where(and(eq(outbox.aggregateId, orderId), eq(outbox.eventType, 'OrderCancelledEvent')))
    if (row === undefined) throw new Error('OrderCancelledEvent is not in the outbox')
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

  function failNextRefunds(count: number) {
    const spy = vi.spyOn(provider, 'refund') as MockInstance<PaymentProvider['refund']>
    for (let i = 0; i < count; i += 1) {
      spy.mockRejectedValueOnce(new Error('bank down'))
    }
    return spy
  }

  it('банк недоступен при отмене: заказ cancelled, событие в outbox; на повторах доставки рефанд выполнен ровно один раз', async () => {
    await seedPaidOrder()
    const refundSpy = failNextRefunds(2)

    const result = await systemCancel.execute({ tenantId, orderId, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })

    expect(result).toEqual({ orderId, status: 'cancelled', refundIssued: false })
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId))
    expect(order?.status).toBe('cancelled')
    expect(await refundRows()).toBe(0)
    const envelope = await cancelledEnvelope()
    expect(envelope.payload).toMatchObject({ orderId, refundRequired: true })

    await expect(handler.handle(envelope)).rejects.toThrow()
    expect(await refundRows()).toBe(0)
    await handler.handle(envelope)
    await handler.handle(envelope)

    expect(await refundRows()).toBe(1)
    expect(refundSpy).toHaveBeenCalledTimes(3)
  })

  it('банк доступен: рефанд проходит сразу, повторная доставка события ничего не дублирует', async () => {
    await seedPaidOrder()

    const result = await systemCancel.execute({ tenantId, orderId, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })
    await handler.handle(await cancelledEnvelope())

    expect(result.refundIssued).toBe(true)
    expect(await refundRows()).toBe(1)
  })

  it('массовая отмена аптеки: при сбое банка заказ отменён без ошибки, рефанд доведён обработчиком', async () => {
    await seedPaidOrder()
    failNextRefunds(1)

    const result = await cancelPharmacyOrders.execute(pharmacyId)

    expect(result).toEqual({ cancelledOrderIds: [orderId], failedOrderIds: [] })
    expect(await refundRows()).toBe(0)
    await handler.handle(await cancelledEnvelope())
    expect(await refundRows()).toBe(1)
  })

  it('ручная отмена админом: отмена, audit и событие в одной транзакции, склад возвращён, при сбое банка рефанд доводится обработчиком', async () => {
    await seedPaidOrder()
    const adminId = await seedUser(db, tenantId, 'super_admin')
    failNextRefunds(1)

    const result = await adminForceCancel.execute({
      orderId,
      reason: 'обнаружена поддельная лицензия, инцидент INC-2044',
      actor: { userId: adminId, role: 'super_admin' },
      requestId: null,
    })

    expect(result).toEqual({ orderId, status: 'cancelled', refundIssued: false })
    const audit = await pool.query('SELECT 1 FROM audit_log WHERE entity_id = $1 AND category = $2', [orderId, 'force_cancel_order'])
    expect(audit.rowCount).toBe(1)
    const stock = await pool.query<{ quantity: number }>('SELECT quantity FROM pharmacy_inventory WHERE medicine_id = $1', [medicineId])
    expect(stock.rows[0]?.quantity).toBe(6)
    await handler.handle(await cancelledEnvelope())
    expect(await refundRows()).toBe(1)
  })

  it('заказ уже отменён (повторный запуск джобы): системная отмена пропускается, событие не дублируется', async () => {
    await seedPaidOrder()
    await systemCancel.execute({ tenantId, orderId, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })

    const second = await systemCancel.execute({ tenantId, orderId, expectedFromStatus: 'paid_escrow', reason: 'pickup_sla_timeout' })

    expect(second.status).toBe('skipped')
    const events = await db.select({ id: outbox.id }).from(outbox).where(and(eq(outbox.aggregateId, orderId), inArray(outbox.eventType, ['OrderCancelledEvent'])))
    expect(events).toHaveLength(1)
  })
})
