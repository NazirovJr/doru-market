import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const ONBOARDING_SUSPENDED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'onboarding.suspended',
  { required: ['brandName', 'pharmacyName', 'suspensionReason'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: аптека «{{pharmacyName}}» приостановлена. Причина: {{suspensionReason}}.',
        tj: '{{brandName}}: дорухонаи «{{pharmacyName}}» боздошта шуд. Сабаб: {{suspensionReason}}.',
        en: '{{brandName}}: pharmacy "{{pharmacyName}}" has been suspended. Reason: {{suspensionReason}}.',
      },
    },
    {
      channel: 'sms',
      body: {
        ru: '{{brandName}}: «{{pharmacyName}}» приостановлена ({{suspensionReason}}).',
        tj: '{{brandName}}: «{{pharmacyName}}» боздошта шуд ({{suspensionReason}}).',
        en: '{{brandName}}: "{{pharmacyName}}" suspended ({{suspensionReason}}).',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Аптека «{{pharmacyName}}» приостановлена. Причина: {{suspensionReason}}.',
        tj: 'Дорухонаи «{{pharmacyName}}» боздошта шуд. Сабаб: {{suspensionReason}}.',
        en: 'Pharmacy "{{pharmacyName}}" suspended. Reason: {{suspensionReason}}.',
      },
    },
  ],
)
