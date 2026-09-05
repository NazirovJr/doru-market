/**
 * Доменные события модуля `delivery` (EP-13, DTJ-313, `25-module-courier-delivery.md` §A.6).
 *
 * Один файл, discriminated union — тот же приём, что `modules/orders/domain/order-domain-event.ts`
 * (выбран вместо интерфейса-на-файл, образец `catalog/domain/events/*.event.ts`): семь событий
 * этого модуля тесно связаны общей темой «жизненный цикл доставки», а не независимы друг от
 * друга, как события `catalog`; discriminated union даёт exhaustive-проверку в будущем
 * application-слое (`switch (event.type)`), которую набор разрозненных интерфейсов не даёт.
 * Обе формы легальны в этой кодовой базе — внутримодульная организация, не корректностный риск.
 *
 * Не каждое событие эмитируется методом сущности этого тикета:
 * - `DeliveryOfferCreatedEvent`/`DeliveryOfferExpiredEvent` — `DeliveryOffer.create()`/`.expire()`.
 * - `DeliveryFailedEvent` — `DeliveryAssignment.markFailed()`.
 * - `CashReconciliationDiscrepancyEvent` — `CourierShift.close()`.
 * - `CourierRatedEvent` — `CourierRating.create()`.
 * - `DeliveryEscalatedToPoolEvent` — публикуется application-слоем (BullMQ timeout job,
 *   DTJ-314+), КОГДА список офферов исчерпан — это факт об ОТСУТСТВИИ pending-офферов у
 *   назначения, не мутация состояния одной сущности, естественного места на entity нет.
 * - `OrderRefusedAtDoorEvent` — публикуется application-слоем (DTJ-314+) напрямую: SRS-DELIV-026
 *   явно указывает, что `en_route_to_customer → delivery_failed` НЕ используется для этого
 *   случая — `DeliveryAssignment.status` не меняется вовсе, значит нет entity-метода-намерения,
 *   которому естественно принадлежать эмиссии этого события.
 *
 * Транспорт (outbox, at-least-once, `event_id`) — вне домена (SRS-DOM-151), забота вызывающего
 * use case, как и `order-domain-event.ts`.
 */

export type DeliveryDomainEvent =
  | {
      readonly type: 'DeliveryOfferCreatedEvent'
      readonly offerId: string
      readonly deliveryAssignmentId: string
      readonly courierId: string
      readonly sequenceNo: number
      readonly expiresAt: Date
    }
  | {
      readonly type: 'DeliveryOfferExpiredEvent'
      readonly offerId: string
      readonly deliveryAssignmentId: string
      readonly courierId: string
    }
  | {
      readonly type: 'DeliveryEscalatedToPoolEvent'
      readonly deliveryAssignmentId: string
      readonly orderId: string
      readonly candidatesExhausted: true
    }
  | {
      readonly type: 'DeliveryFailedEvent'
      readonly deliveryAssignmentId: string
      readonly orderId: string
      readonly reason: string
      readonly contactAttemptsCount: number
    }
  | {
      readonly type: 'OrderRefusedAtDoorEvent'
      readonly deliveryAssignmentId: string
      readonly orderId: string
      readonly notes: string | null
    }
  | {
      readonly type: 'CashReconciliationDiscrepancyEvent'
      readonly courierShiftId: string
      readonly courierId: string
      readonly discrepancyDiram: bigint
    }
  | {
      readonly type: 'CourierRatedEvent'
      readonly orderId: string
      readonly courierId: string
      readonly rating: number
    }
