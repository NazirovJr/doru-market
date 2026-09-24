import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const BILLING_INVOICE_OVERDUE_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'billing.invoice_overdue',
  { required: ['brandName', 'invoiceNumber', 'amountDueDiram', 'dueDate'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: счёт №{{invoiceNumber}} на {{amountDueDiram}} дирам просрочен (срок был {{dueDate}}). Оплатите как можно скорее.',
        tj: '{{brandName}}: ҳисобварақаи №{{invoiceNumber}} ба маблағи {{amountDueDiram}} дирам аз мӯҳлат гузашт (мӯҳлат {{dueDate}} буд). Ҳарчи зудтар пардохт кунед.',
        en: '{{brandName}}: invoice #{{invoiceNumber}} for {{amountDueDiram}} diram is overdue (was due {{dueDate}}). Please pay as soon as possible.',
      },
    },
    {
      channel: 'sms',
      body: {
        ru: '{{brandName}}: счёт №{{invoiceNumber}} просрочен, {{amountDueDiram}} дирам.',
        tj: '{{brandName}}: ҳисобварақаи №{{invoiceNumber}} аз мӯҳлат гузашт, {{amountDueDiram}} дирам.',
        en: '{{brandName}}: invoice #{{invoiceNumber}} overdue, {{amountDueDiram}} diram.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Счёт №{{invoiceNumber}} на {{amountDueDiram}} дирам просрочен (срок был {{dueDate}}).',
        tj: 'Ҳисобварақаи №{{invoiceNumber}} ба маблағи {{amountDueDiram}} дирам аз мӯҳлат гузашт (мӯҳлат {{dueDate}} буд).',
        en: 'Invoice #{{invoiceNumber}} for {{amountDueDiram}} diram is overdue (was due {{dueDate}}).',
      },
    },
  ],
)
