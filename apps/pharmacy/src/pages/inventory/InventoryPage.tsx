import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { PointEditForm } from '@/features/inventory-manual/ui/PointEditForm'

/**
 * `InventoryPage.tsx` (DTJ-167, EP-05, SRS-INV-015/016) — заменяет заглушку DTJ-166 (см. её JSDoc:
 * «DTJ-167 заменит содержимое, не создаёт файл заново»). Композиция: переключатель вкладок
 * «Точечное редактирование» (`PointEditForm`, реализован этим тикетом) / «Массовое редактирование»
 * (заглушка до DTJ-168, DTJ-167 «Что сделать» п.5).
 *
 * Локальный `Tabs`-переключатель — НЕ импортирован из `packages/ui`: пакет пуст на момент этого
 * тикета (`packages/ui/src/index.ts`, заглушка EP-18 — тот же приём, что `Toast`/`MedicineAutocomplete`
 * в `features/inventory-manual/ui/*`, см. их JSDoc). TODO(EP-18): перенести в `packages/ui`, когда
 * дизайн-система перестанет быть заглушкой.
 *
 * Маршрут `/inventory` УЖЕ зарегистрирован в `app/router.tsx` (DTJ-166, `lazy()` на этот файл) —
 * подключение к рантайму для этого тикета сводится к замене содержимого файла, роутер не правится.
 */

type InventoryTab = 'point_edit' | 'bulk_edit'

const TabButton = ({
  active,
  onClick,
  testId,
  children,
}: {
  readonly active: boolean
  readonly onClick: () => void
  readonly testId: string
  readonly children: string
}): ReactElement => {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={`px-3 py-2 text-sm font-medium ${active ? 'border-b-2 border-brand-primary text-ink' : 'text-ink-muted'}`}
    >
      {children}
    </button>
  )
}

const BulkEditStub = (): ReactElement => {
  const { t } = useT('tj')
  return (
    <p className="text-sm text-ink-muted" data-testid="inventory-bulk-edit-stub">
      {t('pharmacy.inventory.bulk_edit.coming_soon')}
    </p>
  )
}

const InventoryPage = (): ReactElement => {
  const { t } = useT('tj')
  const [tab, setTab] = useState<InventoryTab>('point_edit')

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4 py-8" data-testid="inventory-page">
      <div role="tablist" className="flex gap-2 border-b border-line">
        <TabButton active={tab === 'point_edit'} onClick={() => { setTab('point_edit') }} testId="inventory-tab-point-edit">
          {t('pharmacy.inventory.tabs.point_edit')}
        </TabButton>
        <TabButton active={tab === 'bulk_edit'} onClick={() => { setTab('bulk_edit') }} testId="inventory-tab-bulk-edit">
          {t('pharmacy.inventory.tabs.bulk_edit')}
        </TabButton>
      </div>

      {tab === 'point_edit' ? <PointEditForm /> : <BulkEditStub />}
    </section>
  )
}

export default InventoryPage
