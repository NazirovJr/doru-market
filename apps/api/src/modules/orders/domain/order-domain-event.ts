/**
 * Доменные события `Order` (EP-09, DTJ-222, SRS-DOM-151) и типы для `order.cancel()`. Дополнено
 * DTJ-300 (EP-12, модуль 24 «Терминал фармацевта») — 5 новых вариантов union'а (SRS-PHT-001:
 * терминал — presentation-поверхность над `orders`, отдельный backend-модуль не заводится, поэтому
 * его события — часть ЭТОГО union'а, не нового файла/модуля).
 *
 * Минимальный payload — только то, чем реально владеет `Order` на момент мутации. Обогащение
 * (например, публикация в `outbox` в той же транзакции) — забота вызывающего use case, вне
 * периметра DTJ-221/222 (чистый домен/application, без БД).
 *
 * Не каждый метод-намерение эмитирует событие: `markPaidEscrow`/`markDelivered` — по глоссарию
 * `10-domain-model.md` §«Доменные события», `OrderPaidEvent`/`OrderDeliveredEvent` публикуют
 * `payments`/`delivery` соответственно, не `orders` — см. комментарии в `order.entity.ts`.
 */

export type OrderDomainEvent =
  | { readonly type: 'OrderConfirmedEvent'; readonly orderId: string; readonly at: Date }
  | {
      readonly type: 'OrderProcessingStartedEvent'
      readonly orderId: string
      readonly pharmacistId: string
      readonly slaDeadlineAt: Date
    }
  | {
      readonly type: 'OrderPickedUpEvent'
      readonly orderId: string
      readonly handoverOtpId: string
      readonly at: Date
    }
  | {
      readonly type: 'OrderCancelledEvent'
      readonly orderId: string
      readonly reason: OrderCancelReason
      readonly cancelledBy: string | null
      readonly at: Date
    }
  // ==================== DTJ-300 (EP-12, модуль 24) — далее 5 новых вариантов ====================
  /** SRS-PHT-007/009 — `AcceptOrderUseCase` успешно перевёл заказ в `processing` и мягко
   *  закрепил его за фармацевтом (`orders.assigned_pharmacist_id`, `[РАСШИРЕНИЕ]`, НЕ RBAC).
   *  Публикуется РЯДОМ с `OrderProcessingStartedEvent` (существующее), не вместо него — модуль 24
   *  §A.2 явно требует оба события за один вызов `accept`. */
  | {
      readonly type: 'OrderClaimedEvent'
      readonly orderId: string
      readonly pharmacistId: string
      readonly claimedAt: Date
    }
  /** SRS-PHT-010 — «перехват» заказа другим фармацевтом той же аптеки (`reclaim`). НЕ трогает
   *  `sla_deadline_at` (общий таймер аптеки, не сотрудника) и прогресс сканирования позиций. */
  | {
      readonly type: 'OrderReclaimedEvent'
      readonly orderId: string
      readonly previousPharmacistId: string
      readonly newPharmacistId: string
      readonly reason: OrderReclaimReason
      readonly at: Date
    }
  /** SRS-PHT-020 — создан `order_partial_fulfillment_requests(status='awaiting_customer')`:
   *  ≥1 позиция `unavailable`, решение принято по всем позициям заказа. `itemsSnapshot` — 1:1
   *  с `order_partial_fulfillment_requests.items_snapshot` (JSONB), см. `PartialFulfillmentSnapshotItem`. */
  | {
      readonly type: 'PartialFulfillmentProposedEvent'
      readonly orderId: string
      readonly requestId: string
      readonly itemsSnapshot: readonly PartialFulfillmentSnapshotItem[]
      readonly refundAmountDiram: bigint
      readonly expiresAt: Date
      readonly at: Date
    }
  /**
   * SRS-PHT-022/023/023a — разрешение запроса частичной сборки. Три ИСХОДА — три ОТДЕЛЬНЫХ
   * варианта union'а (общий базовый payload `{ orderId, requestId, at }`, `02` C15: у типа уже 3
   * потребителя — billing/WS `pharmacy:{id}`/аудит, см. таблицу «Новые доменные события» модуля 24),
   * а НЕ один вариант с полем `resolution: 'confirmed'|'rejected'|'auto_confirmed_timeout'` —
   * дискриминант `type` уже несёт этот же смысл, дублирующее поле было бы избыточным.
   *
   * `PartialFulfillmentConfirmedEvent`/`AutoConfirmedEvent` — сумма рефанда/новый итог заказа НЕ
   * дублируются в payload: `ResolvePartialFulfillmentUseCase` уже применяет их синхронно из самой
   * строки `order_partial_fulfillment_requests` (`refund_amount_diram`/`items_total_after_diram`)
   * ДО публикации события (SRS-PHT-022 п.2-3) — событие лишь уведомляет подписчиков (WS/billing
   * outbox), не является источником данных для пересчёта.
   *
   * `PartialFulfillmentRejectedEvent` публикуется ДОПОЛНИТЕЛЬНО к существующему `OrderCancelledEvent`
   * (SRS-PHT-023: отказ клиента отменяет ВЕСЬ заказ через `order.cancel(...)`) — этот вариант
   * отражает переход САМОЙ строки запроса в `status='rejected'`, другого агрегата.
   */
  | {
      readonly type: 'PartialFulfillmentConfirmedEvent'
      readonly orderId: string
      readonly requestId: string
      readonly at: Date
    }
  | {
      readonly type: 'PartialFulfillmentRejectedEvent'
      readonly orderId: string
      readonly requestId: string
      readonly at: Date
    }
  | {
      readonly type: 'PartialFulfillmentAutoConfirmedEvent'
      readonly orderId: string
      readonly requestId: string
      readonly at: Date
    }
  /**
   * ДОБАВЛЕНО (DTJ-304, «Что сделать» п.5 тикета, SRS-PHT-075) — `PaymentProvider.refund()`
   * недоступен (circuit breaker) ПОСЛЕ того, как `order_partial_fulfillment_requests.status`
   * уже необратимо перешёл в `confirmed`/`auto_confirmed_timeout` (статус НЕ откатывается, см.
   * JSDoc `ResolvePartialFulfillmentUseCase`). Сигнал для ОТДЕЛЬНОЙ, вне периметра ЭТОГО
   * тикета, retry-задачи (реконсиляция/повторный частичный рефанд) — ЭТОТ тикет только
   * публикует факт в `outbox` (SRS-DOM-151), реальный consumer (периодический sweep, тот же
   * класс, что `EscrowReconciliationJob`) — задел на будущий тикет, не изобретается здесь
   * (`02` C15: нет абстракции без реального потребителя сегодня, а спецификация ЭТОГО тикета
   * требует именно факт публикации, не полный retry-пайплайн).
   */
  | {
      readonly type: 'PartialFulfillmentRefundRetryRequestedEvent'
      readonly orderId: string
      readonly requestId: string
      readonly refundAmountDiram: bigint
      readonly at: Date
    }
  /** SRS-PHT-029 — новый `otp_codes`-ряд заменил предыдущий действующий код вручения (append-only,
   *  старый ряд теряет силу проверкой ТОЛЬКО против текущего FK, не удаляется). */
  | {
      readonly type: 'HandoverOtpRegeneratedEvent'
      readonly orderId: string
      readonly deliveryAssignmentId: string
      readonly regeneratedAt: Date
      readonly regenerationsUsed: number
    }

/**
 * SRS-ORD-030 — канонический enum причин отмены (не свободная строка).
 *
 * `customer_rejected_partial_fulfillment` — ДОБАВЛЕНО (DTJ-304, EP-12 §A.4, SRS-PHT-023):
 * клиент отклонил изменённый (частичный) состав заказа — `ResolvePartialFulfillmentUseCase`
 * (`confirmed=false`) вызывает `order.cancel(...)` именно с этой причиной. `actor.kind='user'`
 * (клиент), НЕ `system` — отказ явно исходит от клиента, даже если сам вызов пришёл через
 * `source='customer'`-путь (единственный реализуемый в этом тикете источник `confirmed=false`,
 * см. JSDoc `ResolvePartialFulfillmentUseCase` — `source='timeout'` трактует молчание как
 * СОГЛАСИЕ, SRS-PHT-023a, никогда не производит `confirmed=false`).
 */
export const ORDER_CANCEL_REASON_VALUES = [
  'customer_changed_mind',
  'found_cheaper_elsewhere',
  'pharmacy_suspended',
  'payment_timeout',
  'pickup_sla_timeout',
  'fraud_or_safety_force_cancel',
  'license_revoked_force_cancel',
  'late_payment_after_cancellation',
  'customer_rejected_partial_fulfillment',
] as const
export type OrderCancelReason = (typeof ORDER_CANCEL_REASON_VALUES)[number]

/** `orders.cancelled_by` — `null` для системных/джоба-инициированных отмен. */
export type OrderCancelActor =
  { readonly kind: 'user'; readonly userId: string } | { readonly kind: 'system' }

/** SRS-PHT-010 — канонический enum причин `reclaim` (не свободная строка), тело `POST .../reclaim`. */
export const ORDER_RECLAIM_REASON_VALUES = ['colleague_unavailable', 'shift_change', 'other'] as const
export type OrderReclaimReason = (typeof ORDER_RECLAIM_REASON_VALUES)[number]

/** SRS-PHT-017/018 — канонический enum причин `report-issue`, 1:1 с CHECK `order_items.item_issue_reason`. */
export const ORDER_ITEM_ISSUE_REASON_VALUES = [
  'out_of_stock',
  'expired_on_shelf',
  'damaged_packaging',
] as const
export type OrderItemIssueReason = (typeof ORDER_ITEM_ISSUE_REASON_VALUES)[number]

/**
 * SRS-PHT-020 — один элемент `order_partial_fulfillment_requests.items_snapshot` (JSONB) для
 * ОДНОЙ `unavailable`-позиции на момент `propose-partial-fulfillment`. `medicineName` — снэпшот
 * названия на момент запроса (не FK-джойн задним числом — товар мог измениться/исчезнуть из
 * каталога до того, как клиент откроет экран подтверждения).
 */
export interface PartialFulfillmentSnapshotItem {
  readonly orderItemId: string
  readonly medicineName: string
  readonly quantity: number
  readonly reason: OrderItemIssueReason
}
