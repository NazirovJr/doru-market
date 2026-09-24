/**
 * Компактный билдер строк сида `notification_templates` (DTJ-369) — 15 `events/*.seed.ts`-файлов
 * иначе повторяли бы одну и ту же плоскую структуру `{eventType, channel, locale, ...}` по 9-12
 * объектов на файл. Здесь один `ChannelTemplateSpec` на канал (тексты трёх локалей рядом, легче
 * сверять на глаз), разворачивается в плоские строки для сида/CI-теста.
 */
import type {
  NotificationTemplateChannel,
  NotificationTemplateLocale,
  NotificationTemplateSeedRow,
  NotificationTemplateVariablesSchema,
} from './types.js'

type LocalizedText = Readonly<Record<NotificationTemplateLocale, string>>

export interface ChannelTemplateSpec {
  readonly channel: NotificationTemplateChannel
  /** SRS-ADM-055: только для `channel ∈ {'email','web_push'}` — не задан для прочих каналов. */
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
