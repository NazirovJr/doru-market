/** Smoke-тест локализации `pharmacy.handover.*` (DTJ-312) — тот же приём, что `picking/i18n-smoke.spec.ts` (DTJ-311). */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const HANDOVER_KEYS: readonly string[] = [
  'pharmacy.handover.title',
  'pharmacy.handover.instructions',
  'pharmacy.handover.loading',
  'pharmacy.handover.error',
  'pharmacy.handover.regenerate_cta',
  'pharmacy.handover.regenerate_rate_limited',
  'pharmacy.handover.regenerate_error',
  'pharmacy.handover.next_order_cta',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/order-fulfillment/handover i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.handover.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of HANDOVER_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
