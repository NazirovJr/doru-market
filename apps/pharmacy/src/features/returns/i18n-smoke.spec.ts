/**
 * Smoke-тест локализации `pharmacy.returns.*` (DTJ-277, тест-план — «рендер всех 3 локалей без
 * падения/непереведённых ключей», тот же приём, что `apps/web/src/features/support/i18n-smoke.spec.ts`,
 * DTJ-284).
 */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { RETURN_REASON_VALUES, RETURN_DISPOSITION_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const PHARMACY_RETURNS_KEYS: readonly string[] = [
  'pharmacy.returns.page.title',
  'pharmacy.returns.list.loading',
  'pharmacy.returns.list.error',
  'pharmacy.returns.list.section.in_transit',
  'pharmacy.returns.list.section.rejected',
  'pharmacy.returns.list.empty.in_transit',
  'pharmacy.returns.list.empty.rejected',
  'pharmacy.returns.card.order_label',
  'pharmacy.returns.card.requested_at',
  'pharmacy.returns.card.confirm_cta',
  'pharmacy.returns.card.reject_cta',
  'pharmacy.returns.checklist.title',
  'pharmacy.returns.checklist.packaging_label',
  'pharmacy.returns.checklist.packaging_locked_hint',
  'pharmacy.returns.checklist.notes_label',
  'pharmacy.returns.checklist.notes_placeholder',
  'pharmacy.returns.checklist.submit',
  'pharmacy.returns.checklist.submit_pending',
  'pharmacy.returns.checklist.cancel',
  'pharmacy.returns.checklist.error',
  'pharmacy.returns.checklist.result.title',
  'pharmacy.returns.checklist.close',
  'pharmacy.returns.reject.reason_label',
  'pharmacy.returns.reject.reason_required',
  'pharmacy.returns.reject.submit',
  'pharmacy.returns.reject.submit_pending',
  'pharmacy.returns.reject.cancel',
  'pharmacy.returns.reject.error',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/returns i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.returns.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of PHARMACY_RETURNS_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все причины возврата (ReturnReason) локализованы', (locale) => {
    const { t } = useT(locale)
    for (const reason of RETURN_REASON_VALUES) {
      expect(t(`pharmacy.returns.reason.${reason}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все disposition (restock/destroy/pending_inspection) локализованы', (locale) => {
    const { t } = useT(locale)
    for (const disposition of RETURN_DISPOSITION_VALUES) {
      expect(t(`pharmacy.returns.checklist.result.${disposition}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
