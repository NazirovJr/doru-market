/**
 * `OrderPolicy` (EP-09, DTJ-222, SRS-DOM-154, SRS-ORD-029/031) — авторизация отмены заказа,
 * `application/policies/` (`02` §3.4: policy — в application, guard — только грубая роль).
 * Образец — первая policy кодовой базы: `modules/auth/application/policies/staff-account.policy.ts`.
 *
 * `canCancel` — чистая функция, без side-effects, возвращает `boolean` (ошибку с `ErrorCode`
 * формирует вызывающий use case, не эта policy).
 *
 * РАСШИРЕНИЕ (DTJ-301, EP-12, модуль 24 «Терминал фармацевта») — `canAccept`/`canReclaim`
 * (тикет называет их `OrderQueuePolicy.canAccept`/`OrdersPolicy.canAccept` в разных местах текста
 * — тот же класс проверки «своя аптека + допустимый статус», что уже есть `canCancel`; отдельный
 * файл/класс НЕ заведён — расширена существующая `OrderPolicy`, см. личные правила проекта
 * «сначала проверить, можно ли расширить существующую функцию/класс»). `pharmacy_admin` допущен
 * наравне с `pharmacist` (SRS-PHT-004: «тот же набор действий», ticket DTJ-301 п.7 — RBAC guard
 * обеих ролей на ВСЕ три эндпоинта терминала), несмотря на то, что сводная таблица §A.11 модуля
 * 24 упоминает в строках `accept`/`reclaim` только `pharmacist` (расхождение зафиксировано в
 * отчёте сдачи, не код-дефект).
 */
import type { UserRole } from '@dorutj/contracts'
import type { Order } from '@/modules/orders/domain/order.entity.js'

/** SRS-DOM-154 — товар физически ещё не покинул аптеку. `picked_up`/`delivered`/терминальные → `false`. */
const CANCELLABLE_STATUSES = new Set(['pending_payment', 'confirmed', 'paid_escrow', 'processing'])

/** SRS-PHT-007 — ещё не принят фармацевтом (обе ветки, non-cash/cash_courier — D-25). */
const ACCEPTABLE_STATUSES = new Set(['paid_escrow', 'confirmed'])

/** SRS-PHT-010 — «перехватить» можно только заказ, реально находящийся в сборке. */
const RECLAIMABLE_STATUSES = new Set(['processing'])

/** `pharmacist`/`pharmacy_admin` — единственные роли терминала (SRS-PHT-004), переиспользуется
 *  `canAccept`/`canReclaim` — вынесено ради DRY (`02` C15), НЕ используется `canCancel`
 *  (та допускает ещё и `customer`, другая матрица). */
function isTerminalStaff(role: UserRole): boolean {
  return role === 'pharmacist' || role === 'pharmacy_admin'
}

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
   * DTJ-301 (SRS-PHT-007) — `actor.pharmacyId === order.pharmacyId И order.status IN
   * ('paid_escrow', 'confirmed')` (буквальная формула тикета, «Что сделать» п.3). НЕ проверяет
   * `assigned_pharmacist_id` (гонку двойного `accept` детектирует use case ДО этой policy — см.
   * `AcceptOrderUseCase` — к моменту вызова этого метода статус уже `processing`, что и так
   * возвращает `false` здесь, но с менее специфичной ошибкой, чем `OrderAlreadyClaimedError`).
   */
  canAccept(order: Order, actor: OrderPolicyActor): boolean {
    if (!isTerminalStaff(actor.role)) return false
    if (actor.pharmacyId !== order.pharmacyId) return false
    return ACCEPTABLE_STATUSES.has(order.status)
  },

  /**
   * DTJ-301 (SRS-PHT-010) — ЛЮБОЙ `pharmacist`/`pharmacy_admin` ТОЙ ЖЕ аптеки, НЕ обязательно
   * текущий держатель (RBAC-скоуп `pharmacy`, блокировка «кто ведёт сборку» — чисто UX,
   * SRS-PHT-038, не security-мера). Заказ обязан реально быть в сборке (`processing`) — иначе
   * перехватывать нечего.
   */
  canReclaim(order: Order, actor: OrderPolicyActor): boolean {
    if (!isTerminalStaff(actor.role)) return false
    if (actor.pharmacyId !== order.pharmacyId) return false
    return RECLAIMABLE_STATUSES.has(order.status)
  },
}
