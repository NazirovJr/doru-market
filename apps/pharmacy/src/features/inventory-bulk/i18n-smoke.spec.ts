import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

/** Smoke-тест локализации `pharmacy.inventory.bulk_edit.*` (DTJ-168) — тот же приём, что `features/inventory-manual/i18n-smoke.spec.ts` (DTJ-167). */

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const BULK_EDIT_KEYS: readonly string[] = [
  'pharmacy.inventory.bulk_edit.dropzone_placeholder',
  'pharmacy.inventory.bulk_edit.dropzone_selected_file',
  'pharmacy.inventory.bulk_edit.mode_label',
  'pharmacy.inventory.bulk_edit.mode_append_update',
  'pharmacy.inventory.bulk_edit.mode_full_replace',
  'pharmacy.inventory.bulk_edit.mode_required_error',
  'pharmacy.inventory.bulk_edit.download_template',
  'pharmacy.inventory.bulk_edit.download_template_error',
  'pharmacy.inventory.bulk_edit.upload_button',
  'pharmacy.inventory.bulk_edit.upload_pending',
  'pharmacy.inventory.bulk_edit.upload_error',
  'pharmacy.inventory.bulk_edit.upload_accepted',
  'pharmacy.inventory.bulk_edit.progress_title',
  'pharmacy.inventory.bulk_edit.progress_summary',
  'pharmacy.inventory.bulk_edit.progress_done_success',
  'pharmacy.inventory.bulk_edit.progress_done_with_errors',
  'pharmacy.inventory.bulk_edit.progress_download_error_report',
  'pharmacy.inventory.bulk_edit.progress_error_report_error',
  'pharmacy.inventory.bulk_edit.grid_title',
  'pharmacy.inventory.bulk_edit.grid_add_row',
  'pharmacy.inventory.bulk_edit.grid_medicine_column',
  'pharmacy.inventory.bulk_edit.grid_price_column',
  'pharmacy.inventory.bulk_edit.grid_quantity_column',
  'pharmacy.inventory.bulk_edit.grid_expiry_column',
  'pharmacy.inventory.bulk_edit.grid_batch_column',
  'pharmacy.inventory.bulk_edit.grid_remove_row',
  'pharmacy.inventory.bulk_edit.grid_cancel_new_row',
  'pharmacy.inventory.bulk_edit.grid_empty',
  'pharmacy.inventory.bulk_edit.grid_save',
  'pharmacy.inventory.bulk_edit.grid_save_pending',
  'pharmacy.inventory.bulk_edit.grid_save_success',
  'pharmacy.inventory.bulk_edit.grid_save_error',
  'pharmacy.inventory.bulk_edit.grid_page_info',
  'pharmacy.inventory.bulk_edit.grid_prev_page',
  'pharmacy.inventory.bulk_edit.grid_next_page',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/inventory-bulk i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.inventory.bulk_edit.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of BULK_EDIT_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
