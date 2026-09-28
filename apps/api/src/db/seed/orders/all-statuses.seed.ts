// Seed заказов во всех статусах order_status (DTJ-435) с согласованными payment_operations/escrow_ledger/payout_schedule/delivery_assignments,
// плюс ≥1 нетерминальный и каждый терминальный return_status/dispute_status. cash_courier заказы без escrow/payout — как GetOrderDetailAdminUseCase.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql, type SQL } from 'drizzle-orm'
import { SEED_PHARMACIES, SEED_TENANTS, SEED_USERS } from '@dorutj/testing-kit'
import { courierRowId } from '../users/contract-users.seed.js'

const STOCK_TRADE_NAME = 'Ибупрофен 400 мг Фармстандарт'
const ITEM_UNIT_PRICE_TJS = '12.00'
const ITEM_QUANTITY = 2
const ITEMS_TOTAL_TJS = '24.00'
const DELIVERY_FEE_TJS = '15.00'
const TOTAL_AMOUNT_TJS = '39.00'
const HOLD_PERIOD_DAYS = 1
const GROSS_DIRAM = 3900
const COMMISSION_DIRAM = 300
const NET_DIRAM = GROSS_DIRAM - COMMISSION_DIRAM

// Последняя группа UUID — ровно 12 hex-символов: 8 нулей + 4-значный десятичный суффикс (idOf).
const ORDER_ID_PREFIX = '40000000-0000-4000-8000-00000000'
const CHECKOUT_ATTEMPT_ID_PREFIX = '4a000000-0000-4000-8000-00000000'
const ITEM_ID_PREFIX = '41000000-0000-4000-8000-00000000'
const PAYMENT_OP_ID_PREFIX = '50000000-0000-4000-8000-00000000'
const ESCROW_ID_PREFIX = '60000000-0000-4000-8000-00000000'
const PAYOUT_ID_PREFIX = '70000000-0000-4000-8000-00000000'
const DELIVERY_ID_PREFIX = '80000000-0000-4000-8000-00000000'
const RETURN_ID_PREFIX = '90000000-0000-4000-8000-00000000'
const TICKET_ID_PREFIX = 'a0000000-0000-4000-8000-00000000'
const DISPUTE_ID_PREFIX = 'b0000000-0000-4000-8000-00000000'

const ID_SUFFIX_DIGITS = 4
// OrderNumber VO (shared-kernel/domain/value-objects/order-number.vo.ts): формат ровно DTJ-{YYMMDD}-{seq5}, 16 символов.
const ORDER_NUMBER_FAKE_DATE = '999999'
const ORDER_NUMBER_SEQ_DIGITS = 5

function idOf(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(ID_SUFFIX_DIGITS, '0')}`
}

interface OrderSpec {
  readonly n: number
  readonly status: string
  readonly paymentMethod: 'alif_mobi' | 'cash_courier'
  readonly customerId: string
  readonly pharmacyId: string
  readonly tenantId: string
  readonly cancelReason?: string
  readonly cancelledBy?: string
}

const ORDER_SPECS: readonly OrderSpec[] = [
  { n: 1, status: 'pending_payment', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer2.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 2, status: 'confirmed', paymentMethod: 'cash_courier', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.excelCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 3, status: 'paid_escrow', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 4, status: 'processing', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer2.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 5, status: 'picked_up', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.excelCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 6, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 7, status: 'cancelled', paymentMethod: 'cash_courier', customerId: SEED_USERS.customer2.id, pharmacyId: SEED_PHARMACIES.excelCenter.id, tenantId: SEED_TENANTS.neutral.id, cancelReason: 'customer_changed_mind', cancelledBy: SEED_USERS.customer2.id },
  { n: 8, status: 'refunded', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 9, status: 'return_in_progress', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer2.id, pharmacyId: SEED_PHARMACIES.excelCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 10, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 11, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer2.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 12, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.excelCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 13, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer2.id, pharmacyId: SEED_PHARMACIES.excelCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 14, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer1.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 15, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customer2.id, pharmacyId: SEED_PHARMACIES.oneCCenter.id, tenantId: SEED_TENANTS.neutral.id },
  { n: 16, status: 'delivered', paymentMethod: 'alif_mobi', customerId: SEED_USERS.customerWhiteLabel.id, pharmacyId: SEED_PHARMACIES.whiteLabelCenter.id, tenantId: SEED_TENANTS.whiteLabel.id },
]

const STATUSES_WITH_HOLD = new Set(['paid_escrow', 'processing', 'picked_up', 'delivered', 'refunded', 'return_in_progress'])
const STATUSES_PICKED_UP_OR_LATER = new Set(['picked_up', 'delivered', 'refunded', 'return_in_progress'])

async function resolveMedicineId(db: NodePgDatabase): Promise<string> {
  const result = await db.execute<{ id: string }>(sql`SELECT id FROM medicines WHERE trade_name = ${STOCK_TRADE_NAME} LIMIT 1`)
  const row = result.rows[0]
  if (row === undefined) {
    throw new Error(`[db:seed] medicine not found for orders seed: "${STOCK_TRADE_NAME}"`)
  }
  return row.id
}

async function resolveInventoryId(db: NodePgDatabase, pharmacyId: string, medicineId: string): Promise<string | null> {
  const result = await db.execute<{ id: string }>(
    sql`SELECT id FROM pharmacy_inventory WHERE pharmacy_id = ${pharmacyId} AND medicine_id = ${medicineId} LIMIT 1`,
  )
  return result.rows[0]?.id ?? null
}

/** Статусы, достигнутые ПОСЛЕ сборки заказа (processing_started_at уже проставлен). */
const STATUSES_AFTER_PROCESSING_STARTED = new Set(['processing', 'picked_up', 'delivered', 'refunded', 'return_in_progress'])
/** Статусы, достигнутые ПОСЛЕ вручения курьеру (delivered_at уже проставлен). */
const STATUSES_AFTER_DELIVERED = new Set(['delivered', 'refunded', 'return_in_progress'])

interface OrderTimestamps {
  readonly processingStartedAt: SQL
  readonly pickedUpAt: SQL
  readonly deliveredAt: SQL
}

function buildOrderTimestamps(status: string): OrderTimestamps {
  const NULL = sql`NULL`
  return {
    processingStartedAt: STATUSES_AFTER_PROCESSING_STARTED.has(status) ? sql`NOW() - interval '3 hours'` : NULL,
    pickedUpAt: STATUSES_PICKED_UP_OR_LATER.has(status) ? sql`NOW() - interval '2 hours'` : NULL,
    deliveredAt: STATUSES_AFTER_DELIVERED.has(status) ? sql`NOW() - interval '1 hour'` : NULL,
  }
}

async function insertOrder(db: NodePgDatabase, spec: OrderSpec, medicineId: string): Promise<void> {
  const orderId = idOf(ORDER_ID_PREFIX, spec.n)
  const orderNumber = `DTJ-${ORDER_NUMBER_FAKE_DATE}-${String(spec.n).padStart(ORDER_NUMBER_SEQ_DIGITS, '0')}`
  const checkoutAttemptId = idOf(CHECKOUT_ATTEMPT_ID_PREFIX, spec.n)
  const { processingStartedAt, pickedUpAt, deliveredAt } = buildOrderTimestamps(spec.status)
  const cancelReason = spec.cancelReason ?? null
  const cancelledBy = spec.cancelledBy ?? null

  await db.execute(sql`
    INSERT INTO orders (
      id, order_number, customer_id, pharmacy_id, status, payment_method, items_total_tjs,
      delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id,
      cancel_reason, cancelled_by, processing_started_at, picked_up_at, delivered_at
    ) VALUES (
      ${orderId}, ${orderNumber}, ${spec.customerId}, ${spec.pharmacyId}, ${spec.status}::order_status, ${spec.paymentMethod},
      ${ITEMS_TOTAL_TJS}, ${DELIVERY_FEE_TJS}, ${TOTAL_AMOUNT_TJS}, 'г. Душанбе, seed-адрес доставки', ${spec.tenantId},
      ${checkoutAttemptId}, ${cancelReason}, ${cancelledBy}, ${processingStartedAt}, ${pickedUpAt}, ${deliveredAt}
    )
    ON CONFLICT (id) DO NOTHING;
  `)

  const inventoryId = await resolveInventoryId(db, spec.pharmacyId, medicineId)
  await db.execute(sql`
    INSERT INTO order_items (id, order_id, medicine_id, unit_price_tjs, quantity, total_price_tjs, inventory_batch_id)
    VALUES (${idOf(ITEM_ID_PREFIX, spec.n)}, ${orderId}, ${medicineId}, ${ITEM_UNIT_PRICE_TJS}, ${ITEM_QUANTITY}, ${ITEMS_TOTAL_TJS}, ${inventoryId})
    ON CONFLICT (id) DO NOTHING;
  `)
}

async function insertPendingPaymentOperation(db: NodePgDatabase, spec: OrderSpec, orderId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO payment_operations (id, order_id, operation_type, idempotency_key, provider, status, amount_diram, expires_at)
    VALUES (${idOf(PAYMENT_OP_ID_PREFIX, spec.n)}, ${orderId}, 'create_bill', ${`seed-create-bill-${String(spec.n)}`}, 'alif_mobi', 'pending', ${GROSS_DIRAM}, NOW() + interval '15 minutes')
    ON CONFLICT (id) DO NOTHING;
  `)
}

async function insertEscrowAndPayout(db: NodePgDatabase, spec: OrderSpec, orderId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO escrow_ledger (id, order_id, entry_type, direction, amount_diram)
    VALUES (${idOf(ESCROW_ID_PREFIX, spec.n * 10 + 1)}, ${orderId}, 'hold_created', 'debit', ${GROSS_DIRAM})
    ON CONFLICT (id) DO NOTHING;
  `)

  const payoutStatus = spec.status === 'delivered' ? 'paid' : spec.status === 'refunded' ? 'reversed' : 'pending'
  const paidAt = payoutStatus === 'paid' ? sql`NOW()` : sql`NULL`
  await db.execute(sql`
    INSERT INTO payout_schedule (id, order_id, pharmacy_id, status, gross_amount_diram, commission_diram, net_amount_diram, hold_period_days, due_at, paid_at)
    VALUES (${idOf(PAYOUT_ID_PREFIX, spec.n)}, ${orderId}, ${spec.pharmacyId}, ${payoutStatus}, ${GROSS_DIRAM}, ${COMMISSION_DIRAM}, ${NET_DIRAM}, ${HOLD_PERIOD_DAYS}, NOW() + interval '1 day', ${paidAt})
    ON CONFLICT (id) DO NOTHING;
  `)

  if (spec.status === 'delivered') {
    await db.execute(sql`
      INSERT INTO escrow_ledger (id, order_id, entry_type, direction, amount_diram)
      VALUES (${idOf(ESCROW_ID_PREFIX, spec.n * 10 + 2)}, ${orderId}, 'captured_to_pharmacy', 'credit', ${NET_DIRAM})
      ON CONFLICT (id) DO NOTHING;
    `)
  }
  if (spec.status === 'refunded') {
    await insertRefundEntries(db, spec, orderId)
  }
}

async function insertRefundEntries(db: NodePgDatabase, spec: OrderSpec, orderId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO escrow_ledger (id, order_id, entry_type, direction, amount_diram)
    VALUES (${idOf(ESCROW_ID_PREFIX, spec.n * 10 + 2)}, ${orderId}, 'refunded_to_customer', 'credit', ${GROSS_DIRAM})
    ON CONFLICT (id) DO NOTHING;
  `)
  await db.execute(sql`
    INSERT INTO payment_operations (id, order_id, operation_type, idempotency_key, provider, status, amount_diram)
    VALUES (${idOf(PAYMENT_OP_ID_PREFIX, spec.n * 10 + 2)}, ${orderId}, 'refund_confirmed', ${`seed-refund-confirmed-${String(spec.n)}`}, 'alif_mobi', 'succeeded', ${GROSS_DIRAM})
    ON CONFLICT (id) DO NOTHING;
  `)
}

async function insertPaymentAndEscrow(db: NodePgDatabase, spec: OrderSpec): Promise<void> {
  if (spec.paymentMethod !== 'alif_mobi') return
  const orderId = idOf(ORDER_ID_PREFIX, spec.n)

  if (spec.status === 'pending_payment') {
    await insertPendingPaymentOperation(db, spec, orderId)
    return
  }

  await db.execute(sql`
    INSERT INTO payment_operations (id, order_id, operation_type, idempotency_key, provider, status, amount_diram)
    VALUES (${idOf(PAYMENT_OP_ID_PREFIX, spec.n)}, ${orderId}, 'payment_confirmed', ${`seed-payment-confirmed-${String(spec.n)}`}, 'alif_mobi', 'succeeded', ${GROSS_DIRAM})
    ON CONFLICT (id) DO NOTHING;
  `)

  if (!STATUSES_WITH_HOLD.has(spec.status)) return
  await insertEscrowAndPayout(db, spec, orderId)
}

async function insertDeliveryAssignment(db: NodePgDatabase, spec: OrderSpec): Promise<void> {
  if (!STATUSES_PICKED_UP_OR_LATER.has(spec.status)) return
  const orderId = idOf(ORDER_ID_PREFIX, spec.n)
  const courierId = courierRowId(SEED_USERS.courier1.id)
  const status = spec.status === 'picked_up' ? 'picked_up_from_pharmacy' : 'delivered'
  const deliveredAt = status === 'delivered' ? sql`NOW() - interval '1 hour'` : sql`NULL`
  await db.execute(sql`
    INSERT INTO delivery_assignments (id, order_id, courier_id, status, assigned_at, picked_up_from_pharmacy_at, delivered_at)
    VALUES (${idOf(DELIVERY_ID_PREFIX, spec.n)}, ${orderId}, ${courierId}, ${status}::delivery_assignment_status, NOW() - interval '3 hours', NOW() - interval '2 hours', ${deliveredAt})
    ON CONFLICT (id) DO NOTHING;
  `)
}

async function insertReturnSample(db: NodePgDatabase): Promise<void> {
  const courierId = courierRowId(SEED_USERS.courier2.id)
  const samples = [
    { n: 9, status: 'return_in_transit', reason: 'defect', resolved: false },
    { n: 10, status: 'return_confirmed', reason: 'expired_or_near_expiry', resolved: true },
    { n: 11, status: 'return_rejected', reason: 'wrong_item', resolved: true },
  ] as const
  await Promise.all(
    samples.map((s) => {
      const disposition = s.status === 'return_confirmed' ? 'restock' : null
      const resolvedAt = s.resolved ? sql`NOW()` : sql`NULL`
      return db.execute(sql`
        INSERT INTO order_returns (id, order_id, status, reason, disposition, initiated_by, courier_id, resolved_at)
        VALUES (${idOf(RETURN_ID_PREFIX, s.n)}, ${idOf(ORDER_ID_PREFIX, s.n)}, ${s.status}::return_status, ${s.reason}::return_reason, ${disposition}, ${SEED_USERS.customer1.id}, ${courierId}, ${resolvedAt})
        ON CONFLICT (id) DO NOTHING;
      `)
    }),
  )
}

async function insertDisputeSample(db: NodePgDatabase): Promise<void> {
  const samples = [
    { n: 12, ticketOrderN: 12, status: 'open', resolved: false },
    { n: 13, ticketOrderN: 13, status: 'resolved_reject', resolved: true },
    { n: 8, ticketOrderN: 8, status: 'resolved_refund_full', resolved: true },
    { n: 14, ticketOrderN: 14, status: 'resolved_refund_partial', resolved: true },
    { n: 15, ticketOrderN: 15, status: 'resolved_adjustment', resolved: true },
  ] as const
  await Promise.all(
    samples.map(async (s) => {
      const orderId = idOf(ORDER_ID_PREFIX, s.ticketOrderN)
      const ticketId = idOf(TICKET_ID_PREFIX, s.n)
      await db.execute(sql`
        INSERT INTO support_tickets (id, order_id, tenant_id, channel, category, status, created_by, description)
        VALUES (${ticketId}, ${orderId}, ${SEED_TENANTS.neutral.id}, 'in_app', 'order_quality_defect', ${s.resolved ? 'resolved' : 'open'}, ${SEED_USERS.customer1.id}, 'Seed-обращение по спору DTJ-435')
        ON CONFLICT (id) DO NOTHING;
      `)
      const resolutionReason = s.resolved ? 'Seed-резолюция спора DTJ-435' : null
      const resolvedByUserId = s.resolved ? SEED_USERS.support1.id : null
      const resolutionAmountDiram = s.status === 'resolved_refund_full' ? GROSS_DIRAM : s.status === 'resolved_refund_partial' ? Math.floor(GROSS_DIRAM / 2) : null
      const resolvedAt = s.resolved ? sql`NOW()` : sql`NULL`
      await db.execute(sql`
        INSERT INTO order_disputes (id, order_id, support_ticket_id, status, resolution_reason, resolution_amount_diram, resolved_by_user_id, resolved_by_role, resolution_due_at, resolved_at)
        VALUES (${idOf(DISPUTE_ID_PREFIX, s.n)}, ${orderId}, ${ticketId}, ${s.status}::dispute_status, ${resolutionReason}, ${resolutionAmountDiram}, ${resolvedByUserId}, ${resolvedByUserId !== null ? 'support_agent' : null}, NOW() + interval '1 day', ${resolvedAt})
        ON CONFLICT (id) DO NOTHING;
      `)
    }),
  )
}

export async function seedOrdersAllStatuses(db: NodePgDatabase): Promise<void> {
  const medicineId = await resolveMedicineId(db)
  await Promise.all(
    ORDER_SPECS.map(async (spec) => {
      await insertOrder(db, spec, medicineId)
      await insertPaymentAndEscrow(db, spec)
      await insertDeliveryAssignment(db, spec)
    }),
  )
  await insertReturnSample(db)
  await insertDisputeSample(db)
}
