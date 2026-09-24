import { buildNotificationTemplateRows } from '../build-rows.js'
import type { NotificationTemplateSeedRow } from '../types.js'

export const INVENTORY_SYNC_ERRORS_TEMPLATE_ROWS: readonly NotificationTemplateSeedRow[] = buildNotificationTemplateRows(
  'inventory.sync_errors',
  { required: ['brandName', 'batchId', 'errorCount'] },
  [
    {
      channel: 'telegram',
      body: {
        ru: '{{brandName}}: синхронизация остатков (партия {{batchId}}) завершена с {{errorCount}} ошибками. Проверьте отчёт.',
        tj: '{{brandName}}: ҳамоҳангсозии захира (гурӯҳи {{batchId}}) бо {{errorCount}} хато анҷом ёфт. Ҳисоботро тафтиш кунед.',
        en: '{{brandName}}: inventory sync (batch {{batchId}}) finished with {{errorCount}} errors. Check the report.',
      },
    },
    {
      channel: 'web_push',
      subject: { ru: 'Ошибки синхронизации остатков', tj: 'Хатоҳои ҳамоҳангсозии захира', en: 'Inventory sync errors' },
      body: {
        ru: 'Партия {{batchId}}: {{errorCount}} ошибок.',
        tj: 'Гурӯҳи {{batchId}}: {{errorCount}} хато.',
        en: 'Batch {{batchId}}: {{errorCount}} errors.',
      },
    },
    {
      channel: 'in_app',
      body: {
        ru: 'Синхронизация {{batchId}} завершена с {{errorCount}} ошибками.',
        tj: 'Ҳамоҳангсозии {{batchId}} бо {{errorCount}} хато анҷом ёфт.',
        en: 'Sync {{batchId}} finished with {{errorCount}} errors.',
      },
    },
  ],
)
