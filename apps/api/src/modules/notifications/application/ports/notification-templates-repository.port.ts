/** Только чтение — строки пишет сид, не API. */
import type {
  NotificationTemplate,
  NotificationTemplateChannel,
  NotificationTemplateLocale,
} from '../../domain/notification-template.entity.js'

export const NOTIFICATION_TEMPLATES_REPOSITORY_PORT = Symbol.for(
  '@dorutj/notifications/notification-templates-repository-port',
)

export interface NotificationTemplatesRepositoryPort {
  findByEventChannelLocale(
    eventType: string,
    channel: NotificationTemplateChannel,
    locale: NotificationTemplateLocale,
  ): Promise<NotificationTemplate | null>
}
