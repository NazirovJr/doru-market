/**
 * Smoke-тест локализации (DTJ-284, тест-план: «Smoke-тест локализации всех 6 категорий на 3
 * языках»), расширено на весь `customer.support.*` набор ключей.
 */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { SUPPORT_TICKET_CATEGORY_VALUES, SUPPORT_TICKET_STATUS_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const CUSTOMER_SUPPORT_KEYS: readonly string[] = [
  'customer.support.page_title',
  'customer.support.unauthenticated',
  'customer.support.contact_button',
  'customer.support.list.loading',
  'customer.support.list.empty',
  'customer.support.form.title',
  'customer.support.form.category_label',
  'customer.support.form.description_label',
  'customer.support.form.submit',
  'customer.support.form.submit_pending',
  'customer.support.form.success',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('customer/support i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи customer.support.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of CUSTOMER_SUPPORT_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все 6 категорий локализованы (ticket «Что сделать» п.6)', (locale) => {
    const { t } = useT(locale)
    expect(SUPPORT_TICKET_CATEGORY_VALUES).toHaveLength(6)
    for (const category of SUPPORT_TICKET_CATEGORY_VALUES) {
      expect(t(`support.category.${category}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все 4 статуса локализованы', (locale) => {
    const { t } = useT(locale)
    for (const status of SUPPORT_TICKET_STATUS_VALUES) {
      expect(t(`support.status.${status}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
