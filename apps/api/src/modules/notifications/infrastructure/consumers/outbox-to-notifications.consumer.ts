/**
 * Consumer очереди `domain-events`: резолвит получателей по `NOTIFICATION_EVENT_MATRIX` и
 * вызывает `DispatchNotificationUseCase`. Живёт в apps/api (не apps/worker) — вызывает use case
 * apps/api напрямую. Payload-контракт `{recipients, variables}` — см. отчёт сдачи, ДОПУЩЕНИЕ.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { Job, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { isKnownUserRole, NOTIFICATION_EVENT_MATRIX, type UserRole } from '@dorutj/contracts'
import { DispatchNotificationUseCase } from '@/modules/notifications/application/use-cases/dispatch-notification.use-case.js'
import {
  NOTIFICATIONS_DISPATCH_CONSUMER_NAME,
  NOTIFICATIONS_PROCESSED_EVENTS_PORT,
  type NotificationsProcessedEventsPort,
} from '@/modules/notifications/application/ports/notifications-processed-events.port.js'
import { DOMAIN_EVENTS_WORKER_REDIS_CONNECTION } from './domain-events-worker-connection.provider.js'

/** Копия `apps/worker/src/queues/queue.constants.ts` `QUEUE_NAMES.DOMAIN_EVENTS`. */
export const DOMAIN_EVENTS_QUEUE_NAME = 'domain-events'

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
    @Inject(DOMAIN_EVENTS_WORKER_REDIS_CONNECTION) private readonly connection: Redis,
    @Inject(NOTIFICATIONS_PROCESSED_EVENTS_PORT) private readonly processedEvents: NotificationsProcessedEventsPort,
    @Inject(DispatchNotificationUseCase) private readonly dispatchNotification: DispatchNotificationUseCase,
  ) {}

  public onModuleInit(): void {
    this.worker = new Worker<Record<string, unknown>>(
      DOMAIN_EVENTS_QUEUE_NAME,
      (job: Job<Record<string, unknown>>) => this.process(job),
      { connection: this.connection },
    )
    this.worker.on('failed', (job, error) => {
      this.logger.error(`outbox-to-notifications: job ${job?.id ?? '?'} (${job?.name ?? '?'}) failed — ${error.message}`)
    })
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
    await this.connection.quit()
  }

  public async process(job: Job<Record<string, unknown>>): Promise<void> {
    const eventType = job.name
    const entry = NOTIFICATION_EVENT_MATRIX.find((candidate) => candidate.eventType === eventType)
    if (entry === undefined) {
      return // не наше событие
    }

    const eventId = job.id
    if (eventId === undefined) {
      this.logger.error(`outbox-to-notifications: job без id (eventType=${eventType}) — пропущена, processed_events guard невозможен.`)
      return
    }

    const isNew = await this.processedEvents.markProcessed(NOTIFICATIONS_DISPATCH_CONSUMER_NAME, eventId)
    if (!isNew) {
      this.logger.debug(`outbox-to-notifications: event_id=${eventId} уже обработан — пропущена (SRS-DOM-152).`)
      return
    }

    const payload: OutboxNotificationPayload = isOutboxNotificationPayload(job.data) ? job.data : {}
    const variables: Record<string, string> = payload.variables ?? {}

    await Promise.all(
      entry.recipientRoles.filter(isKnownUserRole).map((role) => {
        const userId = payload.recipients?.[role]
        if (userId === undefined) {
          this.logger.warn(`outbox-to-notifications: eventType=${eventType} без recipients[${role}] в payload — роль пропущена.`)
          return Promise.resolve()
        }
        return this.dispatchNotification
          .execute({ userId, eventType, sourceEventId: eventId, channels: entry.channels, templateVariables: variables })
          .then(() => undefined)
      }),
    )
  }
}
