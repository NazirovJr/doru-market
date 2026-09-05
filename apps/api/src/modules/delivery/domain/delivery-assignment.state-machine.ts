/**
 * Таблица допустимых переходов `delivery_assignment_status` (EP-13, DTJ-313).
 *
 * Единственный источник истины для допустимости «естественного» перехода (`02` §2.4/C15,
 * тот же приём, что `modules/orders/domain/order.state-machine.ts`) — используется КАЖДЫМ
 * методом-намерением `DeliveryAssignment`, не дублируется `if/else`.
 *
 * Источник — `docs/spec/10-domain-model.md` §«State machines»/6 (SRS-DOM-137..144):
 * `unassigned → assigned → en_route_to_pharmacy → picked_up_from_pharmacy → en_route_to_customer
 * → {delivered | delivery_failed}`.
 *
 * `reassign()` — НЕ в этой таблице (bespoke-guard в `delivery-assignment.entity.ts`, тот же
 * приём, что `Order.confirm()`/`markPaidEscrow()`): SRS-DOM-041/SRS-DELIV-034 разрешают его из
 * ЛЮБОЙ нетерминальной стадии (`assigned`..`en_route_to_customer`) обратно в `assigned` (с новым
 * курьером) — это не последовательный шаг «естественного» потока, а боковой переход,
 * применимый сразу к 4 состояниям, неестественно смотрелся бы как self-loop `assigned→assigned`
 * в этой таблице.
 */
import type { DeliveryAssignmentStatus } from '@dorutj/contracts'

/** `Readonly` — единственный источник истины (тот же DoD, что `ORDER_ALLOWED_TRANSITIONS`). */
export const DELIVERY_ASSIGNMENT_ALLOWED_TRANSITIONS: Readonly<
  Record<DeliveryAssignmentStatus, readonly DeliveryAssignmentStatus[]>
> = {
  // SRS-DOM-137, REQ-DELIV-2/REQ-COUR-1/9 (guard'ы тенантности/cold-chain — в assign(), не здесь).
  unassigned: ['assigned'],
  // SRS-DELIV-019.
  assigned: ['en_route_to_pharmacy'],
  // SRS-DOM-140 — заказ переведён в order.status='picked_up', OTP сгенерирован.
  en_route_to_pharmacy: ['picked_up_from_pharmacy'],
  // SRS-DELIV-020.
  picked_up_from_pharmacy: ['en_route_to_customer'],
  // SRS-DOM-142 (delivered, верный OtpCode) / SRS-DOM-143 (delivery_failed, исчерпаны попытки контакта).
  en_route_to_customer: ['delivered', 'delivery_failed'],
  // Терминальные (SRS-DOM-144) — исходящих рёбер нет.
  delivered: [],
  delivery_failed: [],
}

/** `true`, если естественный переход `from → to` разрешён таблицей выше (не покрывает `reassign()`). */
export function isDeliveryAssignmentTransitionAllowed(
  from: DeliveryAssignmentStatus,
  to: DeliveryAssignmentStatus,
): boolean {
  return DELIVERY_ASSIGNMENT_ALLOWED_TRANSITIONS[from].includes(to)
}

/** SRS-DOM-041/SRS-DELIV-034 — `reassign()` разрешён из любой НЕТЕРМИНАЛЬНОЙ, НЕ-`unassigned` стадии. */
export function isReassignableStatus(status: DeliveryAssignmentStatus): boolean {
  return status !== 'unassigned' && status !== 'delivered' && status !== 'delivery_failed'
}
