/** Smoke-тест локализации `pharmacy.partial_fulfillment.*` (DTJ-312) — тот же приём, что `picking/i18n-smoke.spec.ts` (DTJ-311). */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const PARTIAL_FULFILLMENT_KEYS: readonly string[] = [
  'pharmacy.partial_fulfillment.propose_cta',
  'pharmacy.partial_fulfillment.propose_error',
  'pharmacy.partial_fulfillment.awaiting_banner',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/order-fulfillment/partial-fulfillment i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.partial_fulfillment.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of PARTIAL_FULFILLMENT_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
