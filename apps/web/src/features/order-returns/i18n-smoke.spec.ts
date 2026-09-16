/**
 * Smoke-тест локализации (DTJ-276, тест-план: «рендер всех 3 локалей без падения (смоук-тест на
 * отсутствие непереведённых ключей)»). Тот же приём, что `features/support/i18n-smoke.spec.ts`
 * (DTJ-284).
 */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { RETURN_REASON_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const CUSTOMER_RETURNS_KEYS: readonly string[] = [
  'customer.returns.button.request_return',
  'customer.returns.form.reason_label',
  'customer.returns.form.comment_label',
  'customer.returns.form.submit',
  'customer.returns.form.submit_pending',
  'customer.returns.form.success',
  'customer.returns.form.unavailable',
  'customer.returns.status.return_requested',
  'customer.returns.status.return_in_transit',
  'customer.returns.status.return_confirmed',
  'customer.returns.status.return_rejected',
]

const CUSTOMER_VISIBLE_REASONS = RETURN_REASON_VALUES.filter((reason) => reason !== 'undelivered')

const MISSING_KEY_MARKER = '[[missing:'

describe('customer/order-returns i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи customer.returns.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of CUSTOMER_RETURNS_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все причины возврата, видимые клиенту, локализованы', (locale) => {
    const { t } = useT(locale)
    for (const reason of CUSTOMER_VISIBLE_REASONS) {
      expect(t(`customer.returns.reason.${reason}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
