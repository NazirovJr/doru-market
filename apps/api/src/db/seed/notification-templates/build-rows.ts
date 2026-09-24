/** Разворачивает {channel, тексты по локалям} в плоские строки сида. */
import type {
  NotificationTemplateChannel,
  NotificationTemplateLocale,
  NotificationTemplateSeedRow,
  NotificationTemplateVariablesSchema,
} from './types.js'

type LocalizedText = Readonly<Record<NotificationTemplateLocale, string>>

export interface ChannelTemplateSpec {
  readonly channel: NotificationTemplateChannel
  /** Только для email/web_push. */
  readonly subject?: LocalizedText
  readonly body: LocalizedText
}

const LOCALES: readonly NotificationTemplateLocale[] = ['tj', 'ru', 'en']

export function buildNotificationTemplateRows(
  eventType: string,
  variablesSchema: NotificationTemplateVariablesSchema,
  channels: readonly ChannelTemplateSpec[],
): readonly NotificationTemplateSeedRow[] {
  const rows: NotificationTemplateSeedRow[] = []
  for (const spec of channels) {
    for (const locale of LOCALES) {
      rows.push({
        eventType,
        channel: spec.channel,
        locale,
        subject: spec.subject ? spec.subject[locale] : null,
        body: spec.body[locale],
        variablesSchema,
      })
    }
  }
  return rows
}
