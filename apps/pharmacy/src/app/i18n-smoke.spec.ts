/**
 * Smoke-тест локализации `pharmacy.shell.*` (DTJ-433, тест-план — «i18n-smoke новых ключей в трёх
 * локалях», тот же приём, что `features/returns/i18n-smoke.spec.ts`, DTJ-277).
 */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const PHARMACY_SHELL_KEYS: readonly string[] = [
  'pharmacy.shell.nav_aria_label',
  'pharmacy.shell.nav.order_queue',
  'pharmacy.shell.nav.inventory',
  'pharmacy.shell.nav.sync_history',
  'pharmacy.shell.nav.returns',
  'pharmacy.shell.language_switcher_aria_label',
  'pharmacy.shell.logout',
  'pharmacy.shell.staff_fallback',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy app/layout (оболочка кабинета) i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.shell.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of PHARMACY_SHELL_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
