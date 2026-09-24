// Обработчик роутера domain-events: резолвит получателей по NOTIFICATION_EVENT_MATRIX. Payload-контракт {recipients, variables} — ДОПУЩЕНИЕ.
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { isKnownUserRole, NOTIFICATION_EVENT_MATRIX, type UserRole } from '@dorutj/contracts'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from '@/common/events/domain-event-handler.js'
import { PROCESSED_EVENTS_PORT, type ProcessedEventsPort } from '@/common/events/processed-events.port.js'
import { DispatchNotificationUseCase } from '@/modules/notifications/application/use-cases/dispatch-notification.use-case.js'

export const NOTIFICATIONS_DISPATCH_CONSUMER_NAME = 'notifications.dispatch'

interface OutboxNotificationPayload {
  readonly recipients?: Partial<Record<UserRole, string>>
  readonly variables?: Record<string, string>
}

@Injectable()
export class OutboxToNotificationsConsumer implements DomainEventHandler, OnModuleInit {
  private readonly logger = new Logger(OutboxToNotificationsConsumer.name)
  public readonly consumerName = NOTIFICATIONS_DISPATCH_CONSUMER_NAME
  public readonly eventTypes: readonly string[] = NOTIFICATION_EVENT_MATRIX.map((entry) => entry.eventType)

  public constructor(
    @Inject(PROCESSED_EVENTS_PORT) private readonly processedEvents: ProcessedEventsPort,
    @Inject(DispatchNotificationUseCase) private readonly dispatchNotification: DispatchNotificationUseCase,
    @Inject(DomainEventHandlerRegistry) private readonly registry: DomainEventHandlerRegistry,
  ) {}

  public onModuleInit(): void {
    this.registry.register(this)
  }

  public async handle(envelope: DomainEventEnvelope): Promise<void> {
    const entry = NOTIFICATION_EVENT_MATRIX.find((candidate) => candidate.eventType === envelope.eventType)
    if (entry === undefined) {
      return // недостижимо в проде: роутер уже фильтрует по eventTypes, но defensive.
    }

    const isNew = await this.processedEvents.markProcessed(NOTIFICATIONS_DISPATCH_CONSUMER_NAME, envelope.eventId)
    if (!isNew) {
      this.logger.debug(`outbox-to-notifications: event_id=${envelope.eventId} уже обработан — пропущена (SRS-DOM-152).`)
      return
    }

    const payload = envelope.payload as OutboxNotificationPayload
    const variables: Record<string, string> = payload.variables ?? {}

    await Promise.all(
      entry.recipientRoles.filter(isKnownUserRole).map((role) => {
        const userId = payload.recipients?.[role]
        if (userId === undefined) {
          this.logger.warn(`outbox-to-notifications: eventType=${envelope.eventType} без recipients[${role}] в payload — роль пропущена.`)
          return Promise.resolve()
        }
        return this.dispatchNotification
          .execute({ userId, eventType: envelope.eventType, sourceEventId: envelope.eventId, channels: entry.channels, templateVariables: variables })
          .then(() => undefined)
      }),
    )
  }
}
