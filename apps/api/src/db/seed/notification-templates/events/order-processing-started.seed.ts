import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ORDER_PROCESSING_STARTED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'order.processing_started',
  { required: ['brandName', 'orderNumber', 'pharmacyName'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: аптека «{{pharmacyName}}» начала собирать ваш заказ №{{orderNumber}}.',
        tj: '{{brandName}}: дорухонаи «{{pharmacyName}}» фармоиши №{{orderNumber}}-и шуморо ҷамъоварӣ карданро оғоз кард.',
        en: '{{brandName}}: pharmacy "{{pharmacyName}}" started preparing your order #{{orderNumber}}.',
      },
    },
    {
      channel: 'web_push',
      subject: { ru: 'Заказ собирается', tj: 'Фармоиш ҷамъоварӣ мешавад', en: 'Order being prepared' },
      body: {
        ru: '№{{orderNumber}} — «{{pharmacyName}}» уже собирает ваш заказ.',
        tj: '№{{orderNumber}} — «{{pharmacyName}}» фармоишро ҷамъоварӣ карда истодааст.',
        en: '#{{orderNumber}} — "{{pharmacyName}}" is preparing it now.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Заказ №{{orderNumber}} собирается аптекой «{{pharmacyName}}».',
        tj: 'Фармоиши №{{orderNumber}} аз ҷониби дорухонаи «{{pharmacyName}}» ҷамъоварӣ мешавад.',
        en: 'Order #{{orderNumber}} is being prepared by "{{pharmacyName}}".',
      },
    },
  ],
)
