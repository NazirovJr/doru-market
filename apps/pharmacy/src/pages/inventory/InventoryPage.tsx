import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Tabs, type TabItem } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { PointEditForm } from '@/features/inventory-manual/ui/PointEditForm'
import { ExcelImportDropzone } from '@/features/inventory-bulk/ui/ExcelImportDropzone'
import { BulkEditGrid } from '@/features/inventory-bulk/ui/BulkEditGrid'

type InventoryTab = 'point_edit' | 'bulk_edit'

const BulkEditPanel = (): ReactElement => {
  return (
    <div className="flex flex-col gap-6" data-testid="inventory-bulk-edit-panel">
      <ExcelImportDropzone />
      <BulkEditGrid />
    </div>
  )
}

const InventoryPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [tab, setTab] = useState<InventoryTab>('point_edit')

  const tabs: TabItem[] = [
    { id: 'point_edit', label: t('pharmacy.inventory.tabs.point_edit') },
    { id: 'bulk_edit', label: t('pharmacy.inventory.tabs.bulk_edit') },
  ]

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4 py-8" data-testid="inventory-page">
      <Tabs
        tabs={tabs}
        activeId={tab}
        onChange={(id) => { setTab(id as InventoryTab) }}
        aria-label={t('pharmacy.shell.nav.inventory')}
      />

      {tab === 'point_edit' ? <PointEditForm /> : <BulkEditPanel />}
    </section>
  )
}

export default InventoryPage
