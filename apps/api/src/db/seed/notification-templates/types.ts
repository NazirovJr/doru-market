/** Типы сида — pure-data, читаются и apps/api, и tests/arch. */
// eslint-disable-next-line no-restricted-imports -- tests/arch без алиаса @/
import type {
  NotificationTemplateChannel,
  NotificationTemplateLocale,
  NotificationTemplateVariablesSchema,
} from '../../../modules/notifications/domain/notification-template.entity.js'

export type { NotificationTemplateChannel, NotificationTemplateLocale, NotificationTemplateVariablesSchema }

/** Одна строка сида — 1:1 колонки `notification_templates` (без `id`/`updatedAt`, генерируются БД/сидом). */
export interface NotificationTemplateSeedRow {
  readonly eventType: string
  readonly channel: NotificationTemplateChannel
  readonly locale: NotificationTemplateLocale
  readonly subject: string | null
  readonly body: string
  readonly variablesSchema: NotificationTemplateVariablesSchema
}
