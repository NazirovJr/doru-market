import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'

/**
 * Заглушка маршрута `/inventory` (DTJ-166 «Что сделать» п.4: «остальные маршруты — заглушки
 * `<Suspense>`+`lazy()` для DTJ-167/168/169, регистрируются пустыми, следующие тикеты
 * заполняют»). Реальный экран (точечный ввод остатка + каталожный автокомплит, DTJ-167;
 * массовая сетка + Excel-импорт как второй таб, DTJ-168) — вне scope DTJ-166.
 *
 * Этот файл — files_owned DTJ-167 (`apps/pharmacy/src/pages/inventory/InventoryPage.tsx`);
 * DTJ-167 заменит содержимое, не создаёт файл заново.
 */
const InventoryPage = (): ReactElement => {
  const { t } = useT('tj')
  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-4 py-8"
      data-testid="inventory-page-stub"
    >
      <p className="text-base text-ink">{t('pharmacy.page.coming_soon')}</p>
    </section>
  )
}

export default InventoryPage
