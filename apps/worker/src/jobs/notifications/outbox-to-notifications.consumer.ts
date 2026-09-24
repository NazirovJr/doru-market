/**
 * `OutboxToNotificationsConsumer` (DTJ-370, EP-16) — подписчик очереди `domain-events`
 * (`OutboxRelayProcessor`, DTJ-002/016: `queue.add(event.eventType, event.payload, {jobId: event.id})`,
 * `job.name = outbox.event_type`, `job.id = outbox.id`).
 *
 * **ПЕРВЫЙ реальный consumer `domain-events`.** До этого тикета ни один `Worker` не слушал эту
 * очередь (см. JSDoc `OrderDeliveredSubscriber`/`RefundOnReturnResolvedSubscriber`, apps/api,
 * DTJ-244/274: «НИ ОДИН consumer в apps/api её сегодня не слушает... per-event-type роутинг ещё
 * не спроектирован ни для одного потребителя платформы») — роутинг реализован ЗДЕСЬ: `job.name`
 * сверяется с `NOTIFICATION_EVENT_MATRIX` (`@dorutj/contracts`), событие вне матрицы — игнорируется
 * (`return`, НЕ ошибка — оставляет очередь пригодной для будущих отдельных consumer'ов, см. НАЙДЕННУЮ
 * ЧУЖУЮ ПРОБЛЕМУ в отчёте сдачи: два независимых `Worker` на одной очереди `domain-events` делят
 * job'ы конкурентно, БЕЗ фильтрации по имени со стороны BullMQ — если появится второй такой
 * consumer, потребуется единый роутер, не два независимых `Worker`).
 *
 * Идемпотентность (SRS-DOM-152) — `processed_events(consumer_name='notifications.dispatch',
 * event_id=job.id)`, insert-guard ДО резолва получателей.
 *
 * **ДОПУЩЕНИЕ (не зафиксировано тикетом, задокументировано, не домыслено молча):** ни один
 * доменный модуль (`orders`/`payments`/`delivery`/`prescriptions`/...) сегодня НЕ публикует ни
 * одно из 15 событий матрицы, кроме `inventory.sync_errors` (ПРОВЕРЕНО: `grep` по кодовой базе) —
 * контракт `payload` для остальных событий НЕ существует физически. Принят МИНИМАЛЬНЫЙ явный
 * контракт: `payload.recipients: Partial<Record<UserRole, string>>` (userId на роль) +
 * `payload.variables: Record<string, string>` (переменные шаблона, БЕЗ `brandName` — добавляется
 * здесь). Событие без `recipients[role]` для роли из матрицы — эта роль пропускается (лог warn),
 * не ошибка (публикующая сторона может появиться позже, отдельным эпиком).
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Job, Worker, type Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import {
  isKnownUserRole,
  NOTIFICATION_EVENT_MATRIX,
  type NotificationDispatchJobData,
  type UserRole,
} from '@dorutj/contracts'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import { REDIS_CONNECTION } from '../../config/redis-connection.provider.js'
// eslint-disable-next-line no-restricted-imports -- `@/...` не резолвится в worker-рантайме (см. common/health/health.service.ts).
import { QUEUE_NAMES } from '../../queues/queue.constants.js'
import {
  NOTIFICATION_DISPATCH_QUEUE,
  NOTIFICATION_DISPATCH_STORE,
  NOTIFICATIONS_DISPATCH_CONSUMER,
} from './notification-dispatch.constants.js'
import type { NotificationDispatchStorePort } from './notification-dispatch-store.port.js'
import { dispatchToRecipient } from './dispatch-to-recipient.js'
import { enqueueNotificationDispatchJob } from './notification-dispatch-queue.util.js'

interface OutboxNotificationPayload {
  readonly recipients?: Partial<Record<UserRole, string>>
  readonly variables?: Record<string, string>
}

function isOutboxNotificationPayload(value: unknown): value is OutboxNotificationPayload {
  return typeof value === 'object' && value !== null
}

@Injectable()
export class OutboxToNotificationsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxToNotificationsConsumer.name)
  private worker: Worker<Record<string, unknown>> | undefined

  public constructor(
    @Inject(REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(NOTIFICATION_DISPATCH_STORE) private readonly store: NotificationDispatchStorePort,
    @Inject(NOTIFICATION_DISPATCH_QUEUE) private readonly dispatchQueue: Queue<NotificationDispatchJobData>,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<Record<string, unknown>>(
      QUEUE_NAMES.DOMAIN_EVENTS,
      (job: Job<Record<string, unknown>>) => this.process(job),
      { connection: this.connection },
    )
    this.worker.on('failed', (job, error) => {
      this.logger.error(`outbox-to-notifications: job ${job?.id ?? '?'} (${job?.name ?? '?'}) failed — ${error.message}`)
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }

  public async process(job: Job<Record<string, unknown>>): Promise<void> {
    const eventType = job.name
    const entry = NOTIFICATION_EVENT_MATRIX.find((candidate) => candidate.eventType === eventType)
    if (entry === undefined) {
      // Вне матрицы этого consumer'а — не наше событие (см. JSDoc файла про будущий роутинг).
      return
    }

    const eventId = job.id
    if (eventId === undefined) {
      this.logger.error(`outbox-to-notifications: job без id (eventType=${eventType}) — пропущена, processed_events guard невозможен.`)
      return
    }

    const isNew = await this.store.insertProcessedEventIfNew(NOTIFICATIONS_DISPATCH_CONSUMER, eventId)
    if (!isNew) {
      // AC1/TC-ADM-022 — at-least-once доставка outbox, вторая обработка того же event_id — no-op.
      this.logger.debug(`outbox-to-notifications: event_id=${eventId} уже обработан — пропущена (SRS-DOM-152).`)
      return
    }

    const payload: OutboxNotificationPayload = isOutboxNotificationPayload(job.data) ? job.data : {}
    const variables: Record<string, string> = payload.variables ?? {}

    // CourierAssignedEvent и т.п. — ДВЕ независимые цепочки диспетчеризации (АС5 DTJ-370), одна на
    // роль, каждая со своим userId — независимы друг от друга, поэтому параллельно (Promise.all),
    // не последовательный `for await` (no-await-in-loop).
    const recipientUserIds = entry.recipientRoles
      .filter(isKnownUserRole)
      .map((role) => ({ role, userId: payload.recipients?.[role] }))

    await Promise.all(
      recipientUserIds.map(({ role, userId }) => {
        if (userId === undefined) {
          this.logger.warn(
            `outbox-to-notifications: eventType=${eventType} без recipients[${role}] в payload — роль пропущена ` +
              `(см. JSDoc файла §«ДОПУЩЕНИЕ» — публикующая сторона ещё не реализована).`,
          )
          return Promise.resolve()
        }
        return dispatchToRecipient(
          { store: this.store, enqueue: (jobData, jobId) => this.enqueueDispatchJob(jobData, jobId), logger: this.logger },
          { userId, eventType, sourceEventId: eventId, channels: entry.channels, variables },
        )
      }),
    )
  }

  private async enqueueDispatchJob(jobData: NotificationDispatchJobData, jobId: string): Promise<void> {
    await enqueueNotificationDispatchJob(this.dispatchQueue, jobData, jobId)
  }
}
