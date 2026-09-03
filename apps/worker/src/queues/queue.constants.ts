/**
 * Именованные очереди BullMQ apps/worker — единая точка правды для имени очереди, чтобы оно не
 * изобреталось заново каждым эпиком, который начнёт публиковать в неё джобы (DTJ-002, шаг 4).
 *
 * Будущие очереди других эпиков (НЕ создаются здесь — только имя зарезервировано комментарием,
 * чтобы избежать дублирования решения о названии позже, C15 — без абстракции без потребителя):
 *   - inventory-sync    — синхронизация остатков 1С (EP-05)
 *   - prescription-ocr  — распознавание рецептов (EP-08/EP-09)
 *   - notifications     — Telegram/SMS/web-push (EP-15)
 */
export const QUEUE_NAMES = {
  /** Куда `OutboxRelayWorker` публикует доменные события (SRS-DOM-151/152). */
  DOMAIN_EVENTS: 'domain-events',
  /**
   * DTJ-238, SRS-PAY-004. Producer — `apps/api/src/modules/payments/infrastructure/adapters/
   * mock-bank.provider.ts` (`MOCK_BANK_AUTO_PAY_QUEUE_NAME`, СВОЯ копия этой же строки — apps/
   * worker и apps/api отдельные TS-проекты, значение синхронизируется вручную, не импортом).
   * Consumer — `jobs/escrow-timeouts/mock-bank-auto-pay.job.ts`.
   */
  MOCK_BANK_AUTO_PAY: 'mock-bank-auto-pay',
} as const
