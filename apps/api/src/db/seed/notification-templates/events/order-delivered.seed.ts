import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ORDER_DELIVERED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'order.delivered',
  { required: ['brandName', 'orderNumber'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: заказ №{{orderNumber}} доставлен. Спасибо, что выбрали нас!',
        tj: '{{brandName}}: фармоиши №{{orderNumber}} расонида шуд. Ташаккур, ки моро интихоб кардед!',
        en: '{{brandName}}: order #{{orderNumber}} has been delivered. Thank you for choosing us!',
      },
    },
    {
      channel: 'sms',
      body: {
        ru: '{{brandName}}: заказ №{{orderNumber}} доставлен.',
        tj: '{{brandName}}: фармоиши №{{orderNumber}} расонида шуд.',
        en: '{{brandName}}: order #{{orderNumber}} delivered.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Заказ №{{orderNumber}} доставлен.',
        tj: 'Фармоиши №{{orderNumber}} расонида шуд.',
        en: 'Order #{{orderNumber}} delivered.',
      },
    },
  ],
)
