/** Шаблоны `order.courier_assigned` (SRS-ADM-052, `CourierAssignedEvent`). Каналы: telegram → sms → web_push + in_app. */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ORDER_COURIER_ASSIGNED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'order.courier_assigned',
  { required: ['brandName', 'orderNumber', 'courierName', 'courierPhone'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: курьер {{courierName}} ({{courierPhone}}) уже везёт заказ №{{orderNumber}}.',
        tj: '{{brandName}}: курери {{courierName}} ({{courierPhone}}) фармоиши №{{orderNumber}}-ро мебарад.',
        en: '{{brandName}}: courier {{courierName}} ({{courierPhone}}) is now delivering order #{{orderNumber}}.',
      },
    },
    {
      channel: 'sms',
      body: {
        ru: '{{brandName}}: курьер {{courierName}}, {{courierPhone}}, заказ №{{orderNumber}} в пути.',
        tj: '{{brandName}}: курьер {{courierName}}, {{courierPhone}}, фармоиши №{{orderNumber}} дар роҳ аст.',
        en: '{{brandName}}: courier {{courierName}}, {{courierPhone}}, order #{{orderNumber}} is on the way.',
      },
    },
    {
      channel: 'web_push',
      subject: { ru: 'Курьер назначен', tj: 'Курьер таъин шуд', en: 'Courier assigned' },
      body: {
        ru: '{{courierName}} везёт заказ №{{orderNumber}}. Тел.: {{courierPhone}}.',
        tj: '{{courierName}} фармоиши №{{orderNumber}}-ро мебарад. Тел.: {{courierPhone}}.',
        en: '{{courierName}} is delivering order #{{orderNumber}}. Phone: {{courierPhone}}.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Курьер {{courierName}} ({{courierPhone}}) назначен на заказ №{{orderNumber}}.',
        tj: 'Курьер {{courierName}} ({{courierPhone}}) ба фармоиши №{{orderNumber}} таъин шуд.',
        en: 'Courier {{courierName}} ({{courierPhone}}) assigned to order #{{orderNumber}}.',
      },
    },
  ],
)
