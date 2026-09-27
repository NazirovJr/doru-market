// Полнота словарей tj/ru/en для admin.orders.*/admin.order_detail.* — тот же приём, что features/finance/i18n-smoke.spec.ts.
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { ORDER_STATUS_VALUES, ORDER_PAYMENT_METHOD_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ADMIN_ORDERS_KEYS: readonly string[] = [
  'admin.nav.orders',
  'admin.nav.my_orders',
  'admin.orders.title',
  'admin.orders.loading',
  'admin.orders.error',
  'admin.orders.empty',
  'admin.orders.load_more',
  'admin.orders.filter.order_number',
  'admin.orders.filter.status',
  'admin.orders.filter.status_all',
  'admin.orders.filter.tenant_id',
  'admin.orders.filter.pharmacy_id',
  'admin.orders.filter.customer_id',
  'admin.orders.filter.created_from',
  'admin.orders.filter.created_to',
  'admin.orders.filter.apply',
  'admin.orders.filter.reset',
  'admin.orders.filter.sla_breached',
  'admin.orders.column.order_number',
  'admin.orders.column.status',
  'admin.orders.column.tenant',
  'admin.orders.column.pharmacy',
  'admin.orders.column.amount',
  'admin.orders.column.created_at',
  'admin.orders.sla_breached_badge',
  'admin.orders.own.title',
  'admin.order_detail.title',
  'admin.order_detail.loading',
  'admin.order_detail.error',
  'admin.order_detail.field.order_number',
  'admin.order_detail.field.status',
  'admin.order_detail.field.tenant',
  'admin.order_detail.field.pharmacy',
  'admin.order_detail.field.customer',
  'admin.order_detail.field.payment_method',
  'admin.order_detail.field.total_amount',
  'admin.order_detail.section.timeline',
  'admin.order_detail.timeline.created',
  'admin.order_detail.timeline.processing_started',
  'admin.order_detail.timeline.picked_up',
  'admin.order_detail.timeline.delivered',
  'admin.order_detail.section.escrow',
  'admin.order_detail.escrow.not_applicable',
  'admin.order_detail.escrow.empty',
  'admin.order_detail.column.entry_type',
  'admin.order_detail.column.direction',
  'admin.order_detail.column.amount',
  'admin.order_detail.column.created_at',
  'admin.order_detail.section.payout',
  'admin.order_detail.payout.none',
  'admin.order_detail.payout.field.gross',
  'admin.order_detail.payout.field.commission',
  'admin.order_detail.payout.field.net',
  'admin.order_detail.payout.field.status',
  'admin.order_detail.section.prescription',
  'admin.order_detail.prescription.none',
  'admin.order_detail.prescription.show_image',
  'admin.order_detail.actions.placeholder',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('admin/orders i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи admin.orders.*/admin.order_detail.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ADMIN_ORDERS_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все статусы заказа переведены (admin.orders.status.*)', (locale) => {
    const { t } = useT(locale)
    for (const status of ORDER_STATUS_VALUES) {
      expect(t(`admin.orders.status.${status}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все способы оплаты переведены (admin.order_detail.payment_method.*)', (locale) => {
    const { t } = useT(locale)
    for (const method of ORDER_PAYMENT_METHOD_VALUES) {
      expect(t(`admin.order_detail.payment_method.${method}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
