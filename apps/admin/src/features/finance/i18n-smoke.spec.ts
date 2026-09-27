// Полнота словарей tj/ru/en для admin.finance.*/admin.nav.finance_* — тот же приём, что features/users/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { PAYOUT_SCHEDULE_STATUS_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_FINANCE_KEYS: readonly string[] = [
  'admin.nav.finance_escrow_ledger',
  'admin.nav.finance_payout_schedule',
  'admin.nav.finance_reconciliation_alerts',
  'admin.finance.loading',
  'admin.finance.error',
  'admin.finance.load_more',
  'admin.finance.escrow_ledger.title',
  'admin.finance.escrow_ledger.search_label',
  'admin.finance.escrow_ledger.search_submit',
  'admin.finance.escrow_ledger.search_hint',
  'admin.finance.escrow_ledger.empty',
  'admin.finance.escrow_ledger.column.entry_type',
  'admin.finance.escrow_ledger.column.direction',
  'admin.finance.escrow_ledger.column.amount',
  'admin.finance.escrow_ledger.column.created_at',
  'admin.finance.escrow_ledger.column.order',
  'admin.finance.escrow_ledger.direction.debit',
  'admin.finance.escrow_ledger.direction.credit',
  'admin.finance.payout_schedule.title',
  'admin.finance.payout_schedule.filter.status',
  'admin.finance.payout_schedule.filter.status_all',
  'admin.finance.payout_schedule.filter.pharmacy_id',
  'admin.finance.payout_schedule.filter.apply',
  'admin.finance.payout_schedule.filter.reset',
  'admin.finance.payout_schedule.column.order',
  'admin.finance.payout_schedule.column.pharmacy',
  'admin.finance.payout_schedule.column.gross',
  'admin.finance.payout_schedule.column.commission',
  'admin.finance.payout_schedule.column.net',
  'admin.finance.payout_schedule.column.status',
  'admin.finance.payout_schedule.column.due_at',
  'admin.finance.payout_schedule.column.paid_at',
  'admin.finance.payout_schedule.empty',
  'admin.finance.reconciliation_alert_warning',
  'admin.finance.reconciliation_alerts.title',
  'admin.finance.reconciliation_alerts.column.order',
  'admin.finance.reconciliation_alerts.column.discrepancy',
  'admin.finance.reconciliation_alerts.column.repeat_count',
  'admin.finance.reconciliation_alerts.column.detected_at',
  'admin.finance.reconciliation_alerts.column.status',
  'admin.finance.reconciliation_alerts.badge_danger',
  'admin.finance.reconciliation_alerts.empty',
]

const ESCROW_ENTRY_TYPES: readonly string[] = [
  'hold_created',
  'platform_fee_captured',
  'captured_to_pharmacy',
  'refunded_to_customer',
  'partially_refunded',
  'adjustment',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/finance i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.finance.*/admin.nav.finance_* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_FINANCE_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все entry_type эскроу-леджера переведены', (locale) => {
    const { t } = useT(locale)
    for (const entryType of ESCROW_ENTRY_TYPES) {
      expect(t(`admin.finance.escrow_ledger.entry_type.${entryType}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все статусы payout_schedule переведены', (locale) => {
    const { t } = useT(locale)
    for (const status of PAYOUT_SCHEDULE_STATUS_VALUES) {
      expect(t(`admin.finance.payout_schedule.status.${status}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
