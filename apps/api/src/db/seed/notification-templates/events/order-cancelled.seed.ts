/** Шаблоны `order.cancelled` (SRS-ADM-052, `OrderCancelledEvent`/`OrderAutoCancelledEvent`). Каналы: telegram → sms → web_push + in_app. */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ORDER_CANCELLED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'order.cancelled',
  { required: ['brandName', 'orderNumber', 'cancelReason'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: заказ №{{orderNumber}} отменён. Причина: {{cancelReason}}.',
        tj: '{{brandName}}: фармоиши №{{orderNumber}} бекор карда шуд. Сабаб: {{cancelReason}}.',
        en: '{{brandName}}: order #{{orderNumber}} was cancelled. Reason: {{cancelReason}}.',
      },
    },
    {
      channel: 'sms',
      body: {
        ru: '{{brandName}}: заказ №{{orderNumber}} отменён ({{cancelReason}}).',
        tj: '{{brandName}}: фармоиши №{{orderNumber}} бекор шуд ({{cancelReason}}).',
        en: '{{brandName}}: order #{{orderNumber}} cancelled ({{cancelReason}}).',
      },
    },
    {
      channel: 'web_push',
      subject: { ru: 'Заказ отменён', tj: 'Фармоиш бекор шуд', en: 'Order cancelled' },
      body: {
        ru: '№{{orderNumber}}: {{cancelReason}}.',
        tj: '№{{orderNumber}}: {{cancelReason}}.',
        en: '#{{orderNumber}}: {{cancelReason}}.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Заказ №{{orderNumber}} отменён. Причина: {{cancelReason}}.',
        tj: 'Фармоиши №{{orderNumber}} бекор карда шуд. Сабаб: {{cancelReason}}.',
        en: 'Order #{{orderNumber}} cancelled. Reason: {{cancelReason}}.',
      },
    },
  ],
)
