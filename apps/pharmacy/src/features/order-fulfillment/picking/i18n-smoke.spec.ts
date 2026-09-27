/** Smoke-тест локализации `pharmacy.picking.*` — тот же приём, что соседний тест для `order_queue`. */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { REPORT_ITEM_ISSUE_REASON_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const PICKING_KEYS: readonly string[] = [
  'pharmacy.order_queue.card.go_to_picking_cta',
  'pharmacy.picking.page.title',
  'pharmacy.picking.loading',
  'pharmacy.picking.error',
  'pharmacy.picking.all_resolved',
  'pharmacy.picking.sla.remaining',
  'pharmacy.picking.cancelled_dialog.title',
  'pharmacy.picking.cancelled_dialog.body',
  'pharmacy.picking.item.status.pending',
  'pharmacy.picking.item.status.scanned_ok',
  'pharmacy.picking.item.status.unavailable',
  'pharmacy.picking.item.quantity',
  'pharmacy.picking.item.report_issue_cta',
  'pharmacy.picking.item.expired_stock_notice',
  'pharmacy.picking.scan.input_placeholder',
  'pharmacy.picking.scan.submit',
  'pharmacy.picking.scan.submit_pending',
  'pharmacy.picking.scan.error.wrong_barcode',
  'pharmacy.picking.scan.error.wrong_barcode_named',
  'pharmacy.picking.scan.error.already_scanned',
  'pharmacy.picking.scan.error.expired_stock',
  'pharmacy.picking.scan.error.batch_not_available',
  'pharmacy.picking.scan.error.generic',
  'pharmacy.picking.report_issue.title',
  'pharmacy.picking.report_issue.reason_label',
  'pharmacy.picking.report_issue.note_label',
  'pharmacy.picking.report_issue.submit',
  'pharmacy.picking.report_issue.submit_pending',
  'pharmacy.picking.report_issue.cancel',
  'pharmacy.picking.report_issue.error',
  'pharmacy.picking.complete.seal_checkbox_label',
  'pharmacy.picking.complete.cta',
  'pharmacy.picking.complete.error.seal_required',
  'pharmacy.picking.complete.error.expired_stock',
  'pharmacy.picking.complete.error.generic',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/order-fulfillment/picking i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.picking.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of PICKING_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все причины report-issue (ReportItemIssueReason) локализованы', (locale) => {
    const { t } = useT(locale)
    for (const reason of REPORT_ITEM_ISSUE_REASON_VALUES) {
      expect(t(`pharmacy.picking.report_issue.reason.${reason}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
