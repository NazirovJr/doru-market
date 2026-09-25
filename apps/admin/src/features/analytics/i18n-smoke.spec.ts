// Полнота словарей tj/ru/en для admin.analytics_funnel.* — тот же приём, что audit-log/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_ANALYTICS_FUNNEL_KEYS: readonly string[] = [
  'admin.nav.analytics_funnel',
  'admin.analytics_funnel.title',
  'admin.analytics_funnel.loading',
  'admin.analytics_funnel.error',
  'admin.analytics_funnel.period.week',
  'admin.analytics_funnel.period.month',
  'admin.analytics_funnel.amount_somoni',
  'admin.analytics_funnel.hero.shown_title',
  'admin.analytics_funnel.hero.realized_title',
  'admin.analytics_funnel.hero.realized_percent',
  'admin.analytics_funnel.funnel.title',
  'admin.analytics_funnel.step.analog_shown',
  'admin.analytics_funnel.step.analog_clicked',
  'admin.analytics_funnel.step.added_to_cart',
  'admin.analytics_funnel.step.order_placed',
  'admin.analytics_funnel.conversion_from_previous',
  'admin.analytics_funnel.trend.title',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/analytics (funnel) i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.analytics_funnel.*/admin.nav.analytics_funnel без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_ANALYTICS_FUNNEL_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
