/**
 * DTO `CancelOrderUseCase` (EP-09, DTJ-232, SRS-DOM-090/092/093/154/179, SRS-ORD-029/031).
 *
 * `CancelOrderActor.tenantId`/`pharmacyId` — не читаются use case'ом из `AsyncLocalStorage`
 * (`reports/EP09-CTO-BRIEF.md` D-EP09-24): резолвит presentation-слой (DTJ-233, вне периметра
 * этого тикета) и передаёт явным полем команды (SRS-API-043, тот же приём, что `AddCartItemInput`).
 * `reason` — канонический `OrderCancelReason` (домен, DTJ-222): presentation обязана провалидировать
 * Zod-схемой (`@dorutj/contracts`, `CancelOrderRequestSchema`) ДО построения этой команды —
 * произвольная строка сюда попасть не должна (AC5 тикета).
 */
import type { UserRole } from '@dorutj/contracts'
import type { OrderCancelReason } from '@/modules/orders/domain/order-domain-event.js'

export interface CancelOrderActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string
  /** `null` для `customer` — не участвует в проверке принадлежности аптеке (`OrderPolicy`). */
  readonly pharmacyId: string | null
}

export interface CancelOrderCommand {
  readonly orderId: string
  readonly actor: CancelOrderActor
  readonly reason: OrderCancelReason
}

export interface CancelOrderResult {
  readonly orderId: string
  readonly status: 'cancelled'
  /** `true`, если `RefundFacadePort.refundFull` был вызван (D-25 — non-cash в `paid_escrow`/`processing`). */
  readonly refundIssued: boolean
}
