/**
 * Шаблоны `order.paid` (SRS-ADM-052, строка `OrderPaidEvent`). Каналы: telegram → sms → web_push
 * (всегда) + in_app (гарантированный минимум). `savingsDiram` — экономия от аналогов
 * (`catalog.analogs`, EP-07) — ВСЕГДА передаётся диспетчером (DTJ-370), даже `"0"`, движок
 * подстановки не умеет условную логику (см. «Риски» тикета DTJ-369).
 */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ORDER_PAID_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'order.paid',
  { required: ['brandName', 'orderNumber', 'totalDiram', 'savingsDiram'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: заказ №{{orderNumber}} оплачен на сумму {{totalDiram}} дирам. Вы сэкономили {{savingsDiram}} дирам благодаря аналогам.',
        tj: '{{brandName}}: фармоиши №{{orderNumber}} ба маблағи {{totalDiram}} дирам пардохт шуд. Шумо {{savingsDiram}} дирам сарфа кардед.',
        en: '{{brandName}}: order #{{orderNumber}} paid, {{totalDiram}} diram. You saved {{savingsDiram}} diram with generic alternatives.',
      },
    },
    {
      channel: 'sms',
      body: {
        ru: '{{brandName}}: заказ №{{orderNumber}} оплачен, {{totalDiram}} дирам. Экономия {{savingsDiram}} дирам.',
        tj: '{{brandName}}: фармоиши №{{orderNumber}} пардохт шуд, {{totalDiram}} дирам. Сарфа {{savingsDiram}} дирам.',
        en: '{{brandName}}: order #{{orderNumber}} paid, {{totalDiram}} diram. Saved {{savingsDiram}} diram.',
      },
    },
    {
      channel: 'web_push',
      subject: { ru: 'Заказ оплачен', tj: 'Фармоиш пардохт шуд', en: 'Order paid' },
      body: {
        ru: '№{{orderNumber}} на {{totalDiram}} дирам, экономия {{savingsDiram}} дирам.',
        tj: '№{{orderNumber}} ба маблағи {{totalDiram}} дирам, сарфа {{savingsDiram}} дирам.',
        en: '#{{orderNumber}} for {{totalDiram}} diram, saved {{savingsDiram}} diram.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Заказ №{{orderNumber}} оплачен на {{totalDiram}} дирам. Экономия — {{savingsDiram}} дирам.',
        tj: 'Фармоиши №{{orderNumber}} ба маблағи {{totalDiram}} дирам пардохт шуд. Сарфа — {{savingsDiram}} дирам.',
        en: 'Order #{{orderNumber}} paid for {{totalDiram}} diram. You saved {{savingsDiram}} diram.',
      },
    },
  ],
)
