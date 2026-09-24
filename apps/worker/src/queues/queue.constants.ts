/**
 * Именованные очереди BullMQ apps/worker — единая точка правды для имени очереди, чтобы оно не
 * изобреталось заново каждым эпиком, который начнёт публиковать в неё джобы (DTJ-002, шаг 4).
 *
 * Будущие очереди других эпиков (НЕ создаются здесь — только имя зарезервировано комментарием,
 * чтобы избежать дублирования решения о названии позже, C15 — без абстракции без потребителя):
 *   - inventory-sync    — синхронизация остатков 1С (EP-05)
 *   - prescription-ocr  — распознавание рецептов (EP-08/EP-09)
 *
 * `notification-dispatch` (было зарезервировано выше как `notifications`, EP-15 — правильный
 * эпик, DTJ-368, EP-16, и имя очереди — то, что зафиксировано тикетом) заведена ниже.
 */
export const QUEUE_NAMES = {
  /** Куда `OutboxRelayWorker` публикует доменные события (SRS-DOM-151/152). Первый реальный consumer — apps/api `OutboxToNotificationsConsumer` (DTJ-370). */
  DOMAIN_EVENTS: 'domain-events',
  /**
   * DTJ-238, SRS-PAY-004. Producer — `apps/api/src/modules/payments/infrastructure/adapters/
   * mock-bank.provider.ts` (`MOCK_BANK_AUTO_PAY_QUEUE_NAME`, СВОЯ копия этой же строки — apps/
   * worker и apps/api отдельные TS-проекты, значение синхронизируется вручную, не импортом).
   * Consumer — `jobs/escrow-timeouts/mock-bank-auto-pay.job.ts`.
   */
  MOCK_BANK_AUTO_PAY: 'mock-bank-auto-pay',
  /** Producer — apps/api `DispatchNotificationUseCase`, каскад — сам processor. Consumer — `notification-dispatch.processor.ts`. */
  NOTIFICATION_DISPATCH: 'notification-dispatch',
  /**
   * DTJ-304, EP-12 (модуль 24, «Терминал фармацевта»). Producer — `apps/api/src/modules/orders/
   * infrastructure/jobs/partial-fulfillment-timeout.processor.ts`
   * (`PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME`, СВОЯ копия этой же строки, тот же приём, что
   * `MOCK_BANK_AUTO_PAY`). Consumer — `jobs/escrow-timeouts/partial-fulfillment-timeout.job.ts`.
   */
  PARTIAL_FULFILLMENT_TIMEOUT: 'partial-fulfillment-timeout',
  /** DTJ-307 (EP-12). Producer — apps/api `infrastructure/jobs/sla-watchdog.processor.ts` (`SLA_WATCHDOG_QUEUE_NAME`, своя копия строки). Consumer — `jobs/escrow-timeouts/picking-sla-watchdog.job.ts`. */
  PICKING_SLA_WATCHDOG: 'picking-sla-watchdog',
} as const
