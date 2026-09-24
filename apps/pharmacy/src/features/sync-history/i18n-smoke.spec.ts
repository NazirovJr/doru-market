import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const SYNC_HISTORY_KEYS: readonly string[] = [
  'pharmacy.inventory.sync_history.page_title',
  'pharmacy.inventory.sync_history.filter.all',
  'pharmacy.inventory.sync_history.filter.rest',
  'pharmacy.inventory.sync_history.filter.excel',
  'pharmacy.inventory.sync_history.filter.manual',
  'pharmacy.inventory.sync_history.loading',
  'pharmacy.inventory.sync_history.error',
  'pharmacy.inventory.sync_history.empty',
  'pharmacy.inventory.sync_history.load_more',
  'pharmacy.inventory.sync_history.load_more_pending',
  'pharmacy.inventory.sync_history.table.channel_column',
  'pharmacy.inventory.sync_history.table.type_column',
  'pharmacy.inventory.sync_history.table.status_column',
  'pharmacy.inventory.sync_history.table.accepted_column',
  'pharmacy.inventory.sync_history.table.rejected_column',
  'pharmacy.inventory.sync_history.table.received_column',
  'pharmacy.inventory.sync_history.table.completed_column',
  'pharmacy.inventory.sync_history.table.completed_pending',
  'pharmacy.inventory.sync_history.channel.rest',
  'pharmacy.inventory.sync_history.channel.excel',
  'pharmacy.inventory.sync_history.channel.manual',
  'pharmacy.inventory.sync_history.sync_type.delta',
  'pharmacy.inventory.sync_history.sync_type.full',
  'pharmacy.inventory.sync_history.status.queued',
  'pharmacy.inventory.sync_history.status.processing',
  'pharmacy.inventory.sync_history.status.completed_full_success',
  'pharmacy.inventory.sync_history.status.completed_partial_success',
  'pharmacy.inventory.sync_history.status.failed_validation',
  'pharmacy.inventory.sync_history.errors.toggle_expand',
  'pharmacy.inventory.sync_history.errors.toggle_collapse',
  'pharmacy.inventory.sync_history.errors.loading',
  'pharmacy.inventory.sync_history.errors.error',
  'pharmacy.inventory.sync_history.errors.empty',
  'pharmacy.inventory.sync_history.errors.row_label',
  'pharmacy.inventory.sync_history.errors.download_report',
  'pharmacy.inventory.sync_history.errors.download_report_error',
  'pharmacy.inventory.sync_history.stale.label',
  'pharmacy.inventory.sync_history.stale.warning',
  'pharmacy.inventory.sync_history.stale.no_data',
  'pharmacy.inventory.sync_history.moderation.banner',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/sync-history i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.inventory.sync_history.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of SYNC_HISTORY_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
