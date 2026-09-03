import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'

/**
 * Заглушка маршрута `/inventory/sync-history` (DTJ-166 «Что сделать» п.4 — см. JSDoc
 * `InventoryPage.tsx`). Реальный экран (сводная история всех каналов синхронизации с
 * раскрываемыми ошибками) — DTJ-169, вне scope DTJ-166.
 *
 * Этот файл — files_owned DTJ-169 (`apps/pharmacy/src/pages/inventory/SyncHistoryPage.tsx`);
 * DTJ-169 заменит содержимое, не создаёт файл заново.
 */
const SyncHistoryPage = (): ReactElement => {
  const { t } = useT('tj')
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-4 py-8"
      data-testid="sync-history-page-stub"
    >
      <p className="text-base text-ink">{t('pharmacy.page.coming_soon')}</p>
    </section>
  )
}

export default SyncHistoryPage
