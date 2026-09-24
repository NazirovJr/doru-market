/** Шаблоны `payout.status_changed` (SRS-ADM-052, `PayoutPaidEvent`/`PayoutDueEvent`, получатель — `pharmacy_admin`). Каналы: telegram → web_push + in_app. */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const PAYOUT_STATUS_CHANGED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'payout.status_changed',
  { required: ['brandName', 'payoutStatus', 'payoutAmountDiram', 'periodLabel'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: выплата за {{periodLabel}} — статус «{{payoutStatus}}», сумма {{payoutAmountDiram}} дирам.',
        tj: '{{brandName}}: пардохт барои {{periodLabel}} — ҳолат «{{payoutStatus}}», маблағ {{payoutAmountDiram}} дирам.',
        en: '{{brandName}}: payout for {{periodLabel}} — status "{{payoutStatus}}", amount {{payoutAmountDiram}} diram.',
      },
    },
    {
      channel: 'web_push',
      subject: { ru: 'Статус выплаты изменён', tj: 'Ҳолати пардохт тағйир ёфт', en: 'Payout status changed' },
      body: {
        ru: '{{periodLabel}}: «{{payoutStatus}}», {{payoutAmountDiram}} дирам.',
        tj: '{{periodLabel}}: «{{payoutStatus}}», {{payoutAmountDiram}} дирам.',
        en: '{{periodLabel}}: "{{payoutStatus}}", {{payoutAmountDiram}} diram.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Выплата за {{periodLabel}}: статус «{{payoutStatus}}», {{payoutAmountDiram}} дирам.',
        tj: 'Пардохт барои {{periodLabel}}: ҳолат «{{payoutStatus}}», {{payoutAmountDiram}} дирам.',
        en: 'Payout for {{periodLabel}}: status "{{payoutStatus}}", {{payoutAmountDiram}} diram.',
      },
    },
  ],
)
