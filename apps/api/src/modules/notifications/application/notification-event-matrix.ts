/** Реэкспорт единственного источника матрицы событие×роль×канал (`@dorutj/contracts`) — читается tests/arch. */
export { NOTIFICATION_EVENT_MATRIX, type NotificationEventMatrixEntry } from '@dorutj/contracts'

import { NOTIFICATION_EVENT_MATRIX, type NotificationChannel } from '@dorutj/contracts'

const IN_APP_CHANNEL: NotificationChannel = 'in_app'

/** Последний ВНЕШНИЙ канал фолбэка события (без `in_app`). `null` — внешних каналов нет либо eventType неизвестен. */
export function resolveLastExternalChannel(eventType: string): NotificationChannel | null {
  const entry = NOTIFICATION_EVENT_MATRIX.find((candidate) => candidate.eventType === eventType)
  if (entry === undefined) {
    return null
  }
  const externalChannels = entry.channels.filter((channel) => channel !== IN_APP_CHANNEL)
  return externalChannels[externalChannels.length - 1] ?? null
}

/** Пары (eventType, последний внешний канал) для всех событий матрицы, у которых он есть. */
export function listEventsWithExternalFallback(): readonly { readonly eventType: string; readonly lastChannel: NotificationChannel }[] {
  return NOTIFICATION_EVENT_MATRIX.flatMap((entry) => {
    const lastChannel = resolveLastExternalChannel(entry.eventType)
    return lastChannel === null ? [] : [{ eventType: entry.eventType, lastChannel }]
  })
}
