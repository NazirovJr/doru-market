import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ORDER_REFUNDED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'order.refunded',
  { required: ['brandName', 'orderNumber', 'refundDiram'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: по заказу №{{orderNumber}} возвращено {{refundDiram}} дирам.',
        tj: '{{brandName}}: барои фармоиши №{{orderNumber}} {{refundDiram}} дирам баргардонида шуд.',
        en: '{{brandName}}: {{refundDiram}} diram refunded for order #{{orderNumber}}.',
      },
    },
    {
      channel: 'sms',
      body: {
        ru: '{{brandName}}: возврат {{refundDiram}} дирам по заказу №{{orderNumber}}.',
        tj: '{{brandName}}: баргардонидани {{refundDiram}} дирам барои фармоиши №{{orderNumber}}.',
        en: '{{brandName}}: refund {{refundDiram}} diram for order #{{orderNumber}}.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Возврат по заказу №{{orderNumber}}: {{refundDiram}} дирам.',
        tj: 'Баргардонидан барои фармоиши №{{orderNumber}}: {{refundDiram}} дирам.',
        en: 'Refund for order #{{orderNumber}}: {{refundDiram}} diram.',
      },
    },
  ],
)
