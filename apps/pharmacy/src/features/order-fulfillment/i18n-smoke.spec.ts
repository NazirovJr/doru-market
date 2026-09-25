/**
 * Smoke-тест локализации `pharmacy.order_queue.*` (DTJ-310, тот же приём, что
 * `apps/pharmacy/src/features/returns/i18n-smoke.spec.ts`, DTJ-277) — рендер всех 3 локалей без
 * `[[missing: ...]]`.
 */
import { describe, expect, it } from 'vitest'
import { useT, type Locale } from '@dorutj/i18n'
import { ORDER_PAYMENT_METHOD_VALUES, RECLAIM_ORDER_REASON_VALUES } from '@dorutj/contracts'

const LOCALES: readonly Locale[] = ['tj', 'ru', 'en']

const ORDER_QUEUE_KEYS: readonly string[] = [
  'pharmacy.order_queue.page.title',
  'pharmacy.order_queue.loading',
  'pharmacy.order_queue.error',
  'pharmacy.order_queue.section.new',
  'pharmacy.order_queue.section.new_empty',
  'pharmacy.order_queue.section.processing',
  'pharmacy.order_queue.section.processing_empty',
  'pharmacy.order_queue.card.prescription_badge',
  'pharmacy.order_queue.card.items_summary',
  'pharmacy.order_queue.card.accept_cta',
  'pharmacy.order_queue.card.assigned_to_me_badge',
  'pharmacy.order_queue.card.assigned_unknown_badge',
  'pharmacy.order_queue.card.assigned_to_colleague_badge',
  'pharmacy.order_queue.card.unknown_colleague',
  'pharmacy.order_queue.card.reclaim_menu_toggle',
  'pharmacy.order_queue.reclaim.reason_label',
  'pharmacy.order_queue.reclaim.error',
  'pharmacy.order_queue.reclaim.submit',
  'pharmacy.order_queue.reclaim.submit_pending',
  'pharmacy.order_queue.reclaim.cancel',
  'pharmacy.order_queue.new_order_banner.text',
  'pharmacy.order_queue.new_order_banner.dismiss',
  'pharmacy.order_queue.offline_banner.text',
  'pharmacy.order_queue.sound_gate.start_shift_cta',
]

const MISSING_KEY_MARKER = '[[missing:'

describe('apps/pharmacy features/order-fulfillment i18n — 3 локали, все ключи переведены', () => {
  it.each(LOCALES)('%s — все ключи pharmacy.order_queue.* без [[missing: ...]]', (locale) => {
    const { t } = useT(locale)
    for (const key of ORDER_QUEUE_KEYS) {
      expect(t(key)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все способы оплаты (OrderPaymentMethod) локализованы', (locale) => {
    const { t } = useT(locale)
    for (const method of ORDER_PAYMENT_METHOD_VALUES) {
      expect(t(`pharmacy.order_queue.payment_method.${method}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })

  it.each(LOCALES)('%s — все причины перехвата (ReclaimOrderReason) локализованы', (locale) => {
    const { t } = useT(locale)
    for (const reason of RECLAIM_ORDER_REASON_VALUES) {
      expect(t(`pharmacy.order_queue.reclaim.reason.${reason}`)).not.toContain(MISSING_KEY_MARKER)
    }
  })
})
