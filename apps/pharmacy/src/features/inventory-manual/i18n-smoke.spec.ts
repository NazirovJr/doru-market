import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

/**
 * Smoke-тест локализации `pharmacy.inventory.*` (DTJ-167) — тот же приём, что
 * `apps/pharmacy/src/features/returns/i18n-smoke.spec.ts` (DTJ-277): рендер всех 3 локалей без
 * `[[missing: ...]]`. Ноль хардкодных строк (AGENTS.md §9) — эта проверка ловит забытый словарь.
 */

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const PHARMACY_INVENTORY_KEYS: readonly string[] = [
  'pharmacy.inventory.tabs.point_edit',
  'pharmacy.inventory.tabs.bulk_edit',
  'pharmacy.inventory.bulk_edit.coming_soon',
  'pharmacy.inventory.autocomplete.placeholder',
  'pharmacy.inventory.autocomplete.loading',
  'pharmacy.inventory.autocomplete.empty',
  'pharmacy.inventory.autocomplete.error',
  'pharmacy.inventory.point_edit.medicine_label',
  'pharmacy.inventory.point_edit.price_label',
  'pharmacy.inventory.point_edit.price_error',
  'pharmacy.inventory.point_edit.quantity_label',
  'pharmacy.inventory.point_edit.quantity_error',
  'pharmacy.inventory.point_edit.expiry_label',
  'pharmacy.inventory.point_edit.expiry_error',
  'pharmacy.inventory.point_edit.batch_label',
  'pharmacy.inventory.point_edit.batch_placeholder',
  'pharmacy.inventory.point_edit.missing_medicine_link',
  'pharmacy.inventory.point_edit.missing_medicine_stub_message',
  'pharmacy.inventory.point_edit.submit',
  'pharmacy.inventory.point_edit.submit_pending',
  'pharmacy.inventory.point_edit.toast_success',
  'pharmacy.inventory.point_edit.toast_dismiss',
  'pharmacy.inventory.point_edit.error_insufficient_role',
  'pharmacy.inventory.point_edit.error_generic',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/inventory-manual i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.inventory.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of PHARMACY_INVENTORY_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
