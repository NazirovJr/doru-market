/**
 * Шаблоны `prescription.decision` (SRS-ADM-052, `PrescriptionVerifiedEvent`/`RejectedEvent` — ОДИН
 * шаблон-event_type на оба исхода). Движок подстановки не умеет условную логику ({{#if}}), поэтому
 * итоговый текст решения (`decisionText`) вычисляет диспетчер (DTJ-370) ДО вызова `render()` и
 * передаёт готовой строкой — не два разных `event_type`, т.к. форма сообщения («рецепт по заказу
 * №X: <решение>») одинакова для обоих исходов, отличается только содержимое решения. Каналы: telegram + in_app.
 */
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
