/**
 * Инвариант структурной совместимости `paymentMethod`/`status` при `Order.restore()` (EP-09,
 * DTJ-222, доработка по ревью CTO). Вынесено из `order.entity.ts` ради `C2` (≤300 строк/файл) —
 * тот же приём, что `order-create.validators.ts`.
 *
 * D-25 требует НЕ «по соглашению application-слоя», а СТРУКТУРНО (`21-module-orders-payments-
 * escrow.md:689`): `cash_courier` никогда не наблюдается в `pending_payment`/`paid_escrow`
 * (SRS-ORD-027 п.1 — `confirm()` синхронен внутри `create()`); `confirmed` никогда не достижим
 * для non-cash (SRS-ORD-028). Снимок, нарушающий это, — испорченная строка: тихо принять её
 * хуже, чем упасть на восстановлении (тот же довод, что за `save()`-fail-fast в `orders.module.ts`).
 */
import type { OrderPaymentMethod, OrderStatus } from '@dorutj/contracts'

const CASH_COURIER_FORBIDDEN_STATUSES: ReadonlySet<OrderStatus> = new Set(['pending_payment', 'paid_escrow'])

export function assertRestoreSnapshotIntegrity(snapshot: {
  readonly id: string
  readonly paymentMethod: OrderPaymentMethod
  readonly status: OrderStatus
}): void {
  if (snapshot.paymentMethod === 'cash_courier' && CASH_COURIER_FORBIDDEN_STATUSES.has(snapshot.status)) {
    throw new Error(
      `corrupted Order snapshot ${snapshot.id}: payment_method='cash_courier' cannot have status='${snapshot.status}' ` +
        '— D-25/SRS-ORD-027 п.1 requires synchronous confirm() inside create(), this state is structurally unreachable',
    )
  }
  if (snapshot.paymentMethod !== 'cash_courier' && snapshot.status === 'confirmed') {
    throw new Error(
      `corrupted Order snapshot ${snapshot.id}: status='confirmed' is reachable only via payment_method='cash_courier' ` +
        `(SRS-ORD-028), got payment_method='${snapshot.paymentMethod}'`,
    )
  }
}
