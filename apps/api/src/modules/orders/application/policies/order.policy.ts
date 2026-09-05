/**
 * `OrderPolicy` (EP-09, DTJ-222, SRS-DOM-154, SRS-ORD-029/031) — авторизация отмены заказа,
 * `application/policies/` (`02` §3.4: policy — в application, guard — только грубая роль).
 * Образец — первая policy кодовой базы: `modules/auth/application/policies/staff-account.policy.ts`.
 *
 * `canCancel` — чистая функция, без side-effects, возвращает `boolean` (ошибку с `ErrorCode`
 * формирует вызывающий use case, не эта policy).
 */
import type { UserRole } from '@dorutj/contracts'
import type { Order } from '@/modules/orders/domain/order.entity.js'

/** SRS-DOM-154 — товар физически ещё не покинул аптеку. `picked_up`/`delivered`/терминальные → `false`. */
const CANCELLABLE_STATUSES = new Set(['pending_payment', 'confirmed', 'paid_escrow', 'processing'])

export interface OrderPolicyActor {
  readonly role: UserRole
  readonly userId: string
  /** `null` для `customer`/`courier`/`support_agent`/`super_admin` — не участвует в этой проверке. */
  readonly pharmacyId: string | null
}

export const OrderPolicy = {
  /**
   * `customer` — только свой заказ; `pharmacist`/`pharmacy_admin` — только своя аптека
   * (SRS-ORD-031, без согласования `super_admin` — доверенное действие персонала). Любая
   * другая роль (`courier`/`support_agent`/`super_admin` через этот обычный путь) → `false` —
   * форс-отмена (`fraud_or_safety`/`license_revoked`) идёт отдельным `ForceCancelIncompleteOrdersUseCase`,
   * вне периметра этой policy.
   */
  canCancel(order: Order, actor: OrderPolicyActor): boolean {
    if (!CANCELLABLE_STATUSES.has(order.status)) {
      return false
    }
    if (actor.role === 'customer') {
      return actor.userId === order.customerId
    }
    if (actor.role === 'pharmacist' || actor.role === 'pharmacy_admin') {
      return actor.pharmacyId === order.pharmacyId
    }
    return false
  },

  /**
   * РАСШИРЕНИЕ (DTJ-302/303, EP-12 §A.3/A.4) — `scan`/`report-issue` терминала фармацевта.
   * ИНАЧЕ, чем `canCancel` выше: РОВНО `pharmacist` (не `pharmacy_admin` — DTJ-302 «Что сделать»
   * п.5: «единственная допустимая роль на этот эндпоинт»), своя аптека. Без проверки
   * `order.status` — пайплайн валидации SRS-PHT-011..018 не называет статус заказа отдельным
   * условием (в отличие от `CANCELLABLE_STATUSES` у `canCancel`), только `fulfillmentStatus`
   * ПОЗИЦИИ — это проверяет use case через `OrderItem.assertPending()`/`markUnavailable()`.
   */
  canManagePicking(order: Order, actor: OrderPolicyActor): boolean {
    return actor.role === 'pharmacist' && actor.pharmacyId === order.pharmacyId
  },
}
