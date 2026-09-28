// Полнота словарей tj/ru/en для admin.finance.commission_rates.*/admin.nav.finance_commission_rates (DTJ-358), тот же приём, что i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { COMMISSION_CATEGORY_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const COMMISSION_RATES_KEYS: readonly string[] = [
  'admin.nav.finance_commission_rates',
  'admin.finance.commission_rate_not_retroactive_warning',
  'admin.finance.commission_rates.title',
  'admin.finance.commission_rates.filter.category',
  'admin.finance.commission_rates.filter.category_all',
  'admin.finance.commission_rates.column.tenant',
  'admin.finance.commission_rates.column.chain',
  'admin.finance.commission_rates.column.category',
  'admin.finance.commission_rates.column.rate',
  'admin.finance.commission_rates.column.effective_from',
  'admin.finance.commission_rates.column.effective_to',
  'admin.finance.commission_rates.column.actions',
  'admin.finance.commission_rates.global',
  'admin.finance.commission_rates.no_end_date',
  'admin.finance.commission_rates.edit_button',
  'admin.finance.commission_rates.add_button',
  'admin.finance.commission_rates.empty',
  'admin.finance.commission_rates.form.category_label',
  'admin.finance.commission_rates.form.tenant_id_label',
  'admin.finance.commission_rates.form.chain_id_label',
  'admin.finance.commission_rates.form.rate_label',
  'admin.finance.commission_rates.form.rate_invalid',
  'admin.finance.commission_rates.form.effective_from_label',
  'admin.finance.commission_rates.form.effective_to_label',
  'admin.finance.commission_rates.form.submit',
  'admin.finance.commission_rates.form.cancel',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/finance commission-rates i18n — 3 локали, все ключи переведены (DTJ-358)', () => {
  it.each(LOCALES)('%s — все ключи admin.finance.commission_rates.*/admin.nav.finance_commission_rates без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of COMMISSION_RATES_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все категории комиссии переведены', (locale) => {
    const { t } = useT(locale)
    for (const category of COMMISSION_CATEGORY_VALUES) {
      expect(t(`admin.finance.commission_rates.category.${category}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
