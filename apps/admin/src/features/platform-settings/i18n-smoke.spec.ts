// Полнота словарей tj/ru/en для admin.platform_settings.*/admin.platform_settings.key.* — тот же приём, что features/finance/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { PLATFORM_SETTINGS_KEY_NAMES, platformSettingDescriptionKey } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_PLATFORM_SETTINGS_KEYS: readonly string[] = [
  'admin.nav.settings',
  'admin.platform_settings.title',
  'admin.platform_settings.description',
  'admin.platform_settings.loading',
  'admin.platform_settings.error',
  'admin.platform_settings.column.key',
  'admin.platform_settings.column.value',
  'admin.platform_settings.column.description',
  'admin.platform_settings.column.redeploy',
  'admin.platform_settings.requires_redeploy',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/platform-settings i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все статические ключи admin.platform_settings.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_PLATFORM_SETTINGS_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — descriptionKey КАЖДОГО PLATFORM_SETTINGS_KEY_NAMES переведён (полнота, не выборочно)', (locale) => {
    const { t } = useT(locale)
    for (const name of PLATFORM_SETTINGS_KEY_NAMES) {
      expect(t(platformSettingDescriptionKey(name))).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
