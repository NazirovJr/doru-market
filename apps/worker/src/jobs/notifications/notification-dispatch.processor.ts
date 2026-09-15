/**
 * `NotificationDispatchProcessor` (DTJ-368, EP-16) — ПУСТОЙ consumer-скелет очереди
 * `notification-dispatch` (`QUEUE_NAMES.NOTIFICATION_DISPATCH`, `notification-dispatch.module.ts`
 * рядом). Обработчик логики (матрица диспетчеризации каналов, тихие часы, ретраи) — `DTJ-370`,
 * здесь — только сам класс с `TODO(DTJ-370)`.
 *
 * **Отличие от буквального текста тикета** (задокументировано, не молча): тикет описывает класс
 * как `@Processor('notification-dispatch')` — декоратор пакета `@nestjs/bullmq`. Этот пакет НЕ
 * является зависимостью репозитория (ПРОВЕРЕНО: отсутствует в `package.json` ОБОИХ apps/api и
 * apps/worker, и не встречается нигде в кодовой базе) — весь `apps/worker` последовательно
 * использует СЫРОЙ `bullmq` (`Queue`/`Worker` напрямую, см. `outbox-relay.processor.ts`,
 * `mock-bank-auto-pay.job.ts`), без NestJS-обёртки. Добавление новой зависимости ради одного
 * скелет-тикета сломало бы единообразие — вместо декоратора здесь ТОТ ЖЕ paттерн, что
 * `MockBankAutoPayJob` (ближайший архитектурный аналог: consumer очереди, наполняемой ИЗВНЕ, БЕЗ
 * собственного тика по расписанию, в отличие от `outbox-relay`/`cart-cleanup`) — реальная
 * `Worker`-обвязка, вызывающая `process()`, — в `notification-dispatch.module.ts`.
 *
 * `NotificationDispatchJobData` — форма ПОКА НЕ ЗАФИКСИРОВАНА: ни один producer не публикует в
 * эту очередь на этом тикете (`InAppNotifyProvider`, DTJ-368, пишет в `notifications` НАПРЯМУЮ,
 * минуя очередь — см. его JSDoc; Telegram/SMS/Push через очередь — диспетчер `DTJ-370`). `Record
 * <string, unknown>` — намеренно неструктурированный плейсхолдер, не выдуманная форма, которую
 * `DTJ-370` пришлось бы потом расформировывать.
 */
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'

export type NotificationDispatchJobData = Record<string, unknown>

@Injectable()
export class NotificationDispatchProcessor {
  private readonly logger = new Logger(NotificationDispatchProcessor.name)

  public process(job: Job<NotificationDispatchJobData>): Promise<void> {
    this.logger.warn(`notification-dispatch: джоба ${job.id ?? '?'} получена, но обработчик ещё не реализован (TODO(DTJ-370)).`)
    return Promise.reject(
      new Error('NotificationDispatchProcessor.process() has no implementation yet — TODO(DTJ-370): диспетчеризация по каналам.'),
    )
  }
}
