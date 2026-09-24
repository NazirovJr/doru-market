/** Шаблоны `moderation.queue_digest` (SRS-ADM-052, `UnmatchedInventoryRowEvent`, дайджест раз/сутки, получатель — `pharmacy_admin`). Канал: telegram + in_app. */
import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const MODERATION_QUEUE_DIGEST_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'moderation.queue_digest',
  { required: ['brandName', 'unmatchedCount'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: за сутки накопилось {{unmatchedCount}} позиций без сопоставления в каталоге. Загляните в очередь модерации.',
        tj: '{{brandName}}: дар як шабонарӯз {{unmatchedCount}} мавқеъ бидуни мутобиқат дар каталог ҷамъ шуд. Навбати назоратро дида бароед.',
        en: '{{brandName}}: {{unmatchedCount}} unmatched catalog items accumulated today. Check the moderation queue.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: '{{unmatchedCount}} позиций ждут сопоставления в очереди модерации.',
        tj: '{{unmatchedCount}} мавқеъ дар навбати назорат интизори мутобиқатсозӣ аст.',
        en: '{{unmatchedCount}} items are waiting for matching in the moderation queue.',
      },
    },
  ],
)
