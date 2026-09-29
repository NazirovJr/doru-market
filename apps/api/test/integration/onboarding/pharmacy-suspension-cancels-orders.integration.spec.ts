import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { TestingModule } from '@nestjs/testing'
import { orders } from '@/db/schema/orders.js'
import { escrowLedger, paymentOperations } from '@/db/schema/payments.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import { SuspendPharmacyUseCase } from '@/modules/onboarding/application/use-cases/suspend-pharmacy.use-case.js'
import { ForceCancelIncompleteOrdersUseCase } from '@/modules/onboarding/application/use-cases/force-cancel-incomplete-orders.use-case.js'
import { bootAppModule } from '../common/__tests__/app-module-boot.js'
import {
  canonicalOrderNumber,
  cleanupMedicine,
  cleanupPharmacy,
  cleanupTenant,
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
} from '../returns/returns-test.fixture.js'

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

const HOLD_AMOUNT_DIRAM = 6_000n
const ORDERED_QUANTITY = 2
const INITIAL_STOCK = 5

describe.skipIf(!postgresAvailable)('Приостановка аптеки: ORDERS_CANCELLATION поверх orders — integration', () => {
  let pool: Pool
  let db: NodePgDatabase
  let app: TestingModule
  let suspendPharmacy: SuspendPharmacyUseCase
  let forceCancel: ForceCancelIncompleteOrdersUseCase

  let tenantId: string
  let adminId: string
  let customerId: string
  let chainId: string
  let pharmacyId: string
  let otherPharmacyId: string
  let medicineId: string
  let batchId: string
  let paidOrderId: string
  let cashOrderId: string
  let deliveredOrderId: string
  let otherPharmacyOrderId: string

  beforeAll(async () => {
    ;({ pool, db } = connect())
    app = await bootAppModule()
    suspendPharmacy = app.get(SuspendPharmacyUseCase, { strict: false })
    forceCancel = app.get(ForceCancelIncompleteOrdersUseCase, { strict: false })
  }, 60_000)

  afterAll(async () => {
    await app.close()
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    const orderIds = [paidOrderId, cashOrderId, deliveredOrderId, otherPharmacyOrderId]
    await db.delete(escrowLedger).where(inArray(escrowLedger.orderId, orderIds)).catch(() => undefined)
    await db.delete(paymentOperations).where(inArray(paymentOperations.orderId, orderIds)).catch(() => undefined)
    await cleanupTenant(db, tenantId)
    await cleanupMedicine(db, medicineId)
    await cleanupPharmacy(db, pharmacyId, chainId)
    await cleanupPharmacy(db, otherPharmacyId)
  })

  async function seedOrderWithItem(input: {
    readonly status: 'paid_escrow' | 'confirmed' | 'delivered'
    readonly paymentMethod: 'alif_mobi' | 'cash_courier'
    readonly forPharmacyId: string
  }): Promise<string> {
    const orderId = await seedOrder(db, {
      tenantId,
      customerId,
      pharmacyId: input.forPharmacyId,
      status: input.status,
      paymentMethod: input.paymentMethod,
      orderNumber: canonicalOrderNumber(),
      ...(input.status === 'delivered' && { deliveredAt: new Date() }),
    })
    await seedOrderItem({ db, orderId, medicineId, inventoryBatchId: batchId, quantity: ORDERED_QUANTITY })
    return orderId
  }

  async function seedHold(orderId: string): Promise<void> {
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

  async function seedScenario(): Promise<void> {
    tenantId = await seedTenant(db)
    adminId = await seedUser(db, tenantId, 'super_admin')
    customerId = await seedUser(db, tenantId, 'customer')
    chainId = await seedChain(db)
    pharmacyId = await seedPharmacy(db, chainId)
    await pool.query(`UPDATE pharmacies SET status = 'active' WHERE id = $1`, [pharmacyId])
    otherPharmacyId = await seedPharmacy(db)
    ;({ medicineId, inventoryBatchId: batchId } = await seedMedicineWithInventory({
      db,
      pharmacyId,
      expiresAt: new Date(Date.now() + 365 * 24 * 3_600_000),
      initialQuantity: INITIAL_STOCK,
    }))
    paidOrderId = await seedOrderWithItem({ status: 'paid_escrow', paymentMethod: 'alif_mobi', forPharmacyId: pharmacyId })
    await seedHold(paidOrderId)
    cashOrderId = await seedOrderWithItem({ status: 'confirmed', paymentMethod: 'cash_courier', forPharmacyId: pharmacyId })
    deliveredOrderId = await seedOrderWithItem({ status: 'delivered', paymentMethod: 'alif_mobi', forPharmacyId: pharmacyId })
    otherPharmacyOrderId = await seedOrderWithItem({ status: 'confirmed', paymentMethod: 'cash_courier', forPharmacyId: otherPharmacyId })
  }

  async function statusOf(orderId: string): Promise<string | null | undefined> {
    const [row] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId))
    return row?.status
  }

  async function refundRows(orderId: string): Promise<{ amountDiram: bigint }[]> {
    return db
      .select({ amountDiram: escrowLedger.amountDiram })
      .from(escrowLedger)
      .where(and(eq(escrowLedger.orderId, orderId), eq(escrowLedger.entryType, 'refunded_to_customer')))
  }

  it('приостановка с принудительной отменой: оба незавершённых заказа отменены, оплаченный возвращён в леджере', async () => {
    await seedScenario()

    const suspended = await suspendPharmacy.execute({ pharmacyId, actorId: adminId, reason: 'fraud_or_safety', notes: null })
    expect(suspended.requiresForceCancelAction).toBe(true)
    const result = await forceCancel.execute({ pharmacyId, actorId: adminId, reason: 'fraud confirmed by support' })

    expect([...result.cancelledOrderIds].sort()).toEqual([paidOrderId, cashOrderId].sort())
    expect(await statusOf(paidOrderId)).toBe('cancelled')
    expect(await statusOf(cashOrderId)).toBe('cancelled')
    const refunds = await refundRows(paidOrderId)
    expect(refunds).toHaveLength(1)
    expect(refunds[0]?.amountDiram).toBe(HOLD_AMOUNT_DIRAM)
    expect(await refundRows(cashOrderId)).toHaveLength(0)
    const [stock] = await db.select({ quantity: pharmacyInventory.quantity }).from(pharmacyInventory).where(eq(pharmacyInventory.id, batchId))
    expect(stock?.quantity).toBe(INITIAL_STOCK + 2 * ORDERED_QUANTITY)
  })

  it('приостановка без force-cancel: отменяются только заказы без оплаты, оплаченный идёт штатно; повтор идемпотентен', async () => {
    await seedScenario()

    const first = await suspendPharmacy.execute({ pharmacyId, actorId: adminId, reason: 'voluntary_pause', notes: null })
    const second = await suspendPharmacy.execute({ pharmacyId, actorId: adminId, reason: 'voluntary_pause', notes: null })

    expect(first).toMatchObject({ requiresForceCancelAction: false, cancelledOrderIds: [cashOrderId] })
    expect(second.cancelledOrderIds).toEqual([])
    expect(await statusOf(cashOrderId)).toBe('cancelled')
    expect(await statusOf(paidOrderId)).toBe('paid_escrow')
    expect(await refundRows(paidOrderId)).toHaveLength(0)
    const log = await pool.query('SELECT 1 FROM onboarding_review_log WHERE pharmacy_id = $1', [pharmacyId])
    expect(log.rowCount).toBe(1)
  })

  it('доставленный заказ и заказ другой аптеки не затронуты', async () => {
    await seedScenario()
    await suspendPharmacy.execute({ pharmacyId, actorId: adminId, reason: 'license_revoked', notes: null })

    await forceCancel.execute({ pharmacyId, actorId: adminId, reason: 'license revoked' })

    expect(await statusOf(deliveredOrderId)).toBe('delivered')
    expect(await statusOf(otherPharmacyOrderId)).toBe('confirmed')
  })

  it('повторная принудительная отмена ничего не дублирует: нет новых отмен и второго рефанда', async () => {
    await seedScenario()
    await suspendPharmacy.execute({ pharmacyId, actorId: adminId, reason: 'fraud_or_safety', notes: null })
    await forceCancel.execute({ pharmacyId, actorId: adminId, reason: 'fraud confirmed by support' })

    const second = await forceCancel.execute({ pharmacyId, actorId: adminId, reason: 'fraud confirmed by support' })

    expect(second.cancelledOrderIds).toEqual([])
    expect(await refundRows(paidOrderId)).toHaveLength(1)
    const [stock] = await db.select({ quantity: pharmacyInventory.quantity }).from(pharmacyInventory).where(eq(pharmacyInventory.id, batchId))
    expect(stock?.quantity).toBe(INITIAL_STOCK + 2 * ORDERED_QUANTITY)
  })

  it('аптека не приостановлена -> принудительная отмена отклонена, заказы целы', async () => {
    await seedScenario()

    await expect(forceCancel.execute({ pharmacyId, actorId: adminId, reason: 'no suspension' })).rejects.toThrow(/suspended/)

    expect(await statusOf(paidOrderId)).toBe('paid_escrow')
    expect(await statusOf(cashOrderId)).toBe('confirmed')
  })
})
