/**
 * Алгоритм проверки полноты матрицы `notification_templates` (DTJ-369, SRS-ADM-054, TC-ADM-026).
 * Чистая функция без побочных эффектов — переиспользуется И сид-скриптом (сверка перед записью в
 * БД), И `tests/arch/notification-templates-completeness.spec.ts` (сверка против независимой
 * копии матрицы SRS-ADM-052, читаемой прямо в тесте — см. его JSDoc).
 */
import type { NotificationTemplateChannel, NotificationTemplateLocale, NotificationTemplateSeedRow } from './types.js'

export interface NotificationEventChannelMatrixEntry {
  readonly eventType: string
  readonly channels: readonly NotificationTemplateChannel[]
}

export interface MissingTemplateCombination {
  readonly eventType: string
  readonly channel: NotificationTemplateChannel
  readonly locale: NotificationTemplateLocale
}

function rowKey(eventType: string, channel: string, locale: string): string {
  return `${eventType}::${channel}::${locale}`
}

interface EventChannel {
  readonly eventType: string
  readonly channel: NotificationTemplateChannel
}

/** Отсутствующие тройки для одного канала — вынесено из `findMissingTemplateCombinations` ради max-depth (C≤3). */
function findMissingForChannel(
  present: ReadonlySet<string>,
  eventChannel: EventChannel,
  locales: readonly NotificationTemplateLocale[],
): readonly MissingTemplateCombination[] {
  const { eventType, channel } = eventChannel
  return locales
    .filter((locale) => !present.has(rowKey(eventType, channel, locale)))
    .map((locale) => ({ eventType, channel, locale }))
}

/** Все отсутствующие тройки `(event_type, channel, locale)` — пусто, если сид полон. */
export function findMissingTemplateCombinations(
  rows: readonly NotificationTemplateSeedRow[],
  matrix: readonly NotificationEventChannelMatrixEntry[],
  locales: readonly NotificationTemplateLocale[],
): readonly MissingTemplateCombination[] {
  const present = new Set(rows.map((row) => rowKey(row.eventType, row.channel, row.locale)))
  const missing: MissingTemplateCombination[] = []
  for (const entry of matrix) {
    for (const channel of entry.channels) {
      missing.push(...findMissingForChannel(present, { eventType: entry.eventType, channel }, locales))
    }
  }
  return missing
}

/** Читаемое сообщение по одной отсутствующей комбинации (TC-ADM-026 — «не просто тест упал»). */
export function formatMissingCombination(missing: MissingTemplateCombination): string {
  return `(event_type="${missing.eventType}", channel="${missing.channel}", locale="${missing.locale}")`
}
