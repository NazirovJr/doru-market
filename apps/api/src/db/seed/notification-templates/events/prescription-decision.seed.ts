/** prescription.decision — telegram, in_app; decisionText (verified/rejected) вычисляет диспетчер до render(). */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const PRESCRIPTION_DECISION_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'prescription.decision',
  { required: ['brandName', 'orderNumber', 'decisionText'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: рецепт по заказу №{{orderNumber}} — {{decisionText}}.',
        tj: '{{brandName}}: нусха барои фармоиши №{{orderNumber}} — {{decisionText}}.',
        en: '{{brandName}}: prescription for order #{{orderNumber}} — {{decisionText}}.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Заказ №{{orderNumber}}: {{decisionText}}.',
        tj: 'Фармоиши №{{orderNumber}}: {{decisionText}}.',
        en: 'Order #{{orderNumber}}: {{decisionText}}.',
      },
    },
  ],
)
