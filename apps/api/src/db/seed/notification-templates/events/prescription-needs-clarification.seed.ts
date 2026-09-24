import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const PRESCRIPTION_NEEDS_CLARIFICATION_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] =
  buildNotificationTemplateRows(
    'prescription.needs_clarification',
    { required: ['brandName', 'orderNumber', 'clarificationReason'] },
    [
      {
        channel: 'telegram',
        body: {
          ru: '{{brandName}}: по рецепту в заказе №{{orderNumber}} нужны уточнения — {{clarificationReason}}.',
          tj: '{{brandName}}: барои нусхаи фармоиши №{{orderNumber}} равшанӣ лозим аст — {{clarificationReason}}.',
          en: '{{brandName}}: prescription for order #{{orderNumber}} needs clarification — {{clarificationReason}}.',
        },
      },
      {
        channel: 'web_push',
        subject: { ru: 'Нужны уточнения по рецепту', tj: 'Барои нусха равшанӣ лозим аст', en: 'Prescription needs clarification' },
        body: {
          ru: '№{{orderNumber}}: {{clarificationReason}}.',
          tj: '№{{orderNumber}}: {{clarificationReason}}.',
          en: '#{{orderNumber}}: {{clarificationReason}}.',
        },
      },
      {
        channel: 'in_app',
        body: {
          ru: 'Заказ №{{orderNumber}}: требуется уточнение по рецепту — {{clarificationReason}}.',
          tj: 'Фармоиши №{{orderNumber}}: барои нусха равшанӣ лозим аст — {{clarificationReason}}.',
          en: 'Order #{{orderNumber}}: prescription clarification needed — {{clarificationReason}}.',
        },
      },
    ],
  )
