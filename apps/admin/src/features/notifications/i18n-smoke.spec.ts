// Полнота словарей tj/ru/en для admin.undelivered_notifications.* — тот же приём, что features/audit-log/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { NOTIFICATION_CHANNEL_VALUES, NOTIFICATION_STATUS_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_UNDELIVERED_NOTIFICATIONS_KEYS: readonly string[] = [
  'admin.nav.undelivered_notifications',
  'admin.undelivered_notifications.title',
  'admin.undelivered_notifications.description',
  'admin.undelivered_notifications.loading',
  'admin.undelivered_notifications.error',
  'admin.undelivered_notifications.empty',
  'admin.undelivered_notifications.load_more',
  'admin.undelivered_notifications.column.recipient',
  'admin.undelivered_notifications.column.event',
  'admin.undelivered_notifications.column.channels',
  'admin.undelivered_notifications.column.last_attempt',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/notifications (undelivered) i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.undelivered_notifications.*/admin.nav.undelivered_notifications без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_UNDELIVERED_NOTIFICATIONS_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все каналы (admin.undelivered_notifications.channel.*) переведены', (locale) => {
    const { t } = useT(locale)
    for (const channel of NOTIFICATION_CHANNEL_VALUES) {
      expect(t(`admin.undelivered_notifications.channel.${channel}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все статусы (admin.undelivered_notifications.status.*) переведены', (locale) => {
    const { t } = useT(locale)
    for (const status of NOTIFICATION_STATUS_VALUES) {
      expect(t(`admin.undelivered_notifications.status.${status}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
