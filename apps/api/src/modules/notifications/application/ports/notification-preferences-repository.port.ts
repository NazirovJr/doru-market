import type { NotificationChannel } from './notify-provider.port.js'
import type { NotificationPreference } from '../../domain/notification-preference.entity.js'

export const NOTIFICATION_PREFERENCES_REPOSITORY_PORT = Symbol.for('@dorutj/notifications/notification-preferences-repository-port')

export interface NotificationPreferencesRepositoryPort {
  findByUserCategoryChannel(userId: string, category: string, channel: NotificationChannel): Promise<NotificationPreference | null>
  listByUser(userId: string): Promise<readonly NotificationPreference[]>
  upsert(preference: NotificationPreference): Promise<NotificationPreference>
}

// Плоская проекция для presentation — та не импортирует domain напрямую (только через application).
export interface NotificationPreferenceView {
  readonly userId: string
  readonly category: string
  readonly channel: NotificationChannel
  readonly isEnabled: boolean
  readonly quietHoursStart: string | null
  readonly quietHoursEnd: string | null
  readonly updatedAt: Date
}

export function toPreferenceView(preference: NotificationPreference): NotificationPreferenceView {
  return {
    userId: preference.userId,
    category: preference.category,
    channel: preference.channel,
    isEnabled: preference.isEnabled,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    updatedAt: preference.updatedAt,
  }
}
