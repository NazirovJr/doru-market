/** ops.sla_breached — web_push, in_app; без telegram/sms (внутренний канал, не клиенту). */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const OPS_SLA_BREACHED_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'ops.sla_breached',
  { required: ['brandName', 'ticketId', 'slaDeadline'] },
  [
    {
      channel: 'web_push',
      subject: { ru: 'Нарушение SLA', tj: 'Вайронкунии SLA', en: 'SLA breached' },
      body: {
        ru: '{{brandName}}: тикет {{ticketId}} просрочен (дедлайн {{slaDeadline}}).',
        tj: '{{brandName}}: тикети {{ticketId}} аз мӯҳлат гузашт (мӯҳлат {{slaDeadline}}).',
        en: '{{brandName}}: ticket {{ticketId}} is overdue (deadline {{slaDeadline}}).',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Тикет {{ticketId}} нарушил SLA (дедлайн был {{slaDeadline}}).',
        tj: 'Тикети {{ticketId}} SLA-ро вайрон кард (мӯҳлат {{slaDeadline}} буд).',
        en: 'Ticket {{ticketId}} breached SLA (deadline was {{slaDeadline}}).',
      },
    },
  ],
)
