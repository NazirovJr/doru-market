import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { PointEditForm } from '@/features/inventory-manual/ui/PointEditForm'
import { ExcelImportDropzone } from '@/features/inventory-bulk/ui/ExcelImportDropzone'
import { BulkEditGrid } from '@/features/inventory-bulk/ui/BulkEditGrid'

type InventoryTab = 'point_edit' | 'bulk_edit'

// TODO(DTJ-408): заменить на Tabs из packages/ui, когда он появится.
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

/** DTJ-168: импорт Excel/CSV + массовая сетка редактирования — заменяет заглушку DTJ-167. */
const BulkEditPanel = (): ReactElement => {
  return (
    <div className="flex flex-col gap-6" data-testid="inventory-bulk-edit-panel">
      <ExcelImportDropzone />
      <BulkEditGrid />
    </div>
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

      {tab === 'point_edit' ? <PointEditForm /> : <BulkEditPanel />}
    </section>
  )
}

export default InventoryPage
