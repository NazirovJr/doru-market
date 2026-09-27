import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, EmptyState } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import { canSaveInventory } from '@/shared/auth/inventory-permissions'
import {
  BULK_GRID_PAGE_SIZE,
  flattenInventoryPages,
  formatMedicineLabel,
  isRowExpiryValid,
  isRowPriceValid,
  isRowQuantityValid,
  isRowValid,
  mergeServerAndLocalRows,
  paginateRows,
  selectDirtyRows,
  totalPageCount,
  useBulkSave,
  useInventoryList,
  type BulkGridRow,
} from '@/features/inventory-bulk/api/use-bulk-grid'
import type { MedicineSuggestionItem } from '@/shared/api/use-medicine-search'
import { MedicinePicker } from './MedicinePicker'

const RANDOM_ID_RADIX = 36

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 'YYYY-MM-DD'.length)
}

function makeRowId(): string {
  return `bulk-row-${Math.random().toString(RANDOM_ID_RADIX).slice(2)}-${String(Date.now())}`
}

// Ячейки — сырые <input>: Input (packages/ui) обязан показать видимый label, задвоив подпись колонки.
const GridRow = ({
  row,
  today,
  readOnly,
  onChange,
  onRemove,
}: {
  readonly row: BulkGridRow
  readonly today: string
  readonly readOnly: boolean
  readonly onChange: (rowId: string, patch: Partial<BulkGridRow>) => void
  readonly onRemove: (rowId: string) => void
}): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const priceInvalid = row.priceTjs.length > 0 && !isRowPriceValid(row.priceTjs)
  const quantityInvalid = row.quantity.length > 0 && !isRowQuantityValid(row.quantity)
  const expiryInvalid = row.expiryDate.length > 0 && !isRowExpiryValid(row.expiryDate, today)

  return (
    <tr data-testid="bulk-grid-row" data-row-id={row.rowId}>
      <td className="px-2 py-1 text-sm text-ink">{row.medicineLabel}</td>
      <td className="px-2 py-1">
        <input
          type="number"
          step="0.01"
          value={row.priceTjs}
          data-testid="bulk-grid-price-input"
          aria-invalid={priceInvalid}
          aria-label={t('pharmacy.inventory.bulk_edit.grid_price_column')}
          disabled={readOnly}
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-50"
          onChange={(event) => { onChange(row.rowId, { priceTjs: event.target.value }) }}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="number"
          step="1"
          value={row.quantity}
          data-testid="bulk-grid-quantity-input"
          aria-invalid={quantityInvalid}
          aria-label={t('pharmacy.inventory.bulk_edit.grid_quantity_column')}
          disabled={readOnly}
          className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-50"
          onChange={(event) => { onChange(row.rowId, { quantity: event.target.value }) }}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="date"
          value={row.expiryDate}
          data-testid="bulk-grid-expiry-input"
          aria-invalid={expiryInvalid}
          aria-label={t('pharmacy.inventory.bulk_edit.grid_expiry_column')}
          disabled={readOnly}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-50"
          onChange={(event) => { onChange(row.rowId, { expiryDate: event.target.value }) }}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="text"
          value={row.batchNumber}
          data-testid="bulk-grid-batch-input"
          aria-label={t('pharmacy.inventory.bulk_edit.grid_batch_column')}
          disabled={readOnly}
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-50"
          onChange={(event) => { onChange(row.rowId, { batchNumber: event.target.value }) }}
        />
      </td>
      <td className="px-2 py-1">
        {readOnly ? null : (
          <Button type="button" variant="ghost" onClick={() => { onRemove(row.rowId) }} data-testid="bulk-grid-remove-row">
            {t('pharmacy.inventory.bulk_edit.grid_remove_row')}
          </Button>
        )}
      </td>
    </tr>
  )
}

// Вынесено из BulkEditGrid — снижает цикломатическую сложность основного компонента (C1, порог 10).
const AddRowControl = ({ canEdit, onClick }: { readonly canEdit: boolean; readonly onClick: () => void }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  if (!canEdit) {
    return (
      <p role="status" data-testid="bulk-grid-readonly-hint" className="text-sm text-ink-muted">
        {t('pharmacy.inventory.point_edit.error_insufficient_role')}
      </p>
    )
  }
  return (
    <Button type="button" variant="secondary" onClick={onClick} data-testid="bulk-grid-add-row-button">
      {t('pharmacy.inventory.bulk_edit.grid_add_row')}
    </Button>
  )
}

export const BulkEditGrid = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [rows, setRows] = useState<readonly BulkGridRow[]>([])
  const [page, setPage] = useState(0)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'success' | 'error'>('idle')
  const bulkSave = useBulkSave()
  const inventoryList = useInventoryList()
  const today = todayIsoDate()
  const hasEditPermission = canSaveInventory(useAuthStore((state) => state.user?.role))

  // Серверные строки — источник истины, локально добавленные/изменённые сохраняются поверх,
  // пока не сохранены (mergeServerAndLocalRows). Следующая серверная страница грузится ПО
  // ТРЕБОВАНИЮ (goToPage) — не при монтировании, иначе у аптеки с тысячами позиций открытие
  // вкладки шлёт десятки запросов подряд.
  const serverRows = flattenInventoryPages(inventoryList.data)
  useEffect(() => {
    setRows((prev) => mergeServerAndLocalRows(serverRows, prev))
  }, [inventoryList.data])

  const totalPages = totalPageCount(rows.length, BULK_GRID_PAGE_SIZE)
  const visibleRows = paginateRows(rows, page, BULK_GRID_PAGE_SIZE)
  const dirtyRows = selectDirtyRows(rows)
  const canSave = hasEditPermission && dirtyRows.length > 0 && dirtyRows.every((row) => isRowValid(row, today)) && !bulkSave.isPending

  function handleAddMedicine(item: MedicineSuggestionItem): void {
    const newRow: BulkGridRow = {
      rowId: makeRowId(),
      medicineId: item.medicineId,
      medicineLabel: formatMedicineLabel(item),
      priceTjs: '',
      quantity: '',
      expiryDate: '',
      batchNumber: '',
      isDirty: true,
    }
    setRows((prev) => [...prev, newRow])
    setIsPickerOpen(false)
    setPage(totalPageCount(rows.length + 1, BULK_GRID_PAGE_SIZE) - 1)
  }

  // Переход на страницу, для которой строк ещё не загружено (или на последнюю загруженную) —
  // подгружает следующую серверную страницу, если она есть.
  function goToPage(targetPage: number): void {
    const loadedPages = totalPageCount(rows.length, BULK_GRID_PAGE_SIZE)
    const needsMoreRows = targetPage >= loadedPages - 1
    if (needsMoreRows && inventoryList.hasNextPage && !inventoryList.isFetchingNextPage) {
      void inventoryList.fetchNextPage()
    }
    setPage(targetPage)
  }

  function handleRowChange(rowId: string, patch: Partial<BulkGridRow>): void {
    setRows((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch, isDirty: true } : row)))
  }

  function handleRemoveRow(rowId: string): void {
    setRows((prev) => prev.filter((row) => row.rowId !== rowId))
  }

  function handleSave(): void {
    setSaveState('idle')
    const savedRowIds = new Set(dirtyRows.map((row) => row.rowId))
    bulkSave.mutate(dirtyRows, {
      onSuccess: (): void => {
        setSaveState('success')
        setRows((prev) => prev.map((row) => (savedRowIds.has(row.rowId) ? { ...row, isDirty: false } : row)))
      },
      onError: (): void => { setSaveState('error') },
    })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="bulk-edit-grid">
      <p className="text-sm font-medium text-ink">{t('pharmacy.inventory.bulk_edit.grid_title')}</p>

      <AddRowControl canEdit={hasEditPermission} onClick={() => { setIsPickerOpen(true) }} />

      {isPickerOpen ? <MedicinePicker onSelect={handleAddMedicine} onCancel={() => { setIsPickerOpen(false) }} /> : null}

      {rows.length === 0 ? (
        <div data-testid="bulk-grid-empty">
          <EmptyState t={t} titleKey="pharmacy.inventory.bulk_edit.grid_empty" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max table-auto border-collapse">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  <th className="px-2 py-1">{t('pharmacy.inventory.bulk_edit.grid_medicine_column')}</th>
                  <th className="px-2 py-1">{t('pharmacy.inventory.bulk_edit.grid_price_column')}</th>
                  <th className="px-2 py-1">{t('pharmacy.inventory.bulk_edit.grid_quantity_column')}</th>
                  <th className="px-2 py-1">{t('pharmacy.inventory.bulk_edit.grid_expiry_column')}</th>
                  <th className="px-2 py-1">{t('pharmacy.inventory.bulk_edit.grid_batch_column')}</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <GridRow key={row.rowId} row={row} today={today} readOnly={!hasEditPermission} onChange={handleRowChange} onRemove={handleRemoveRow} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <Button type="button" variant="ghost" disabled={page === 0} onClick={() => { goToPage(page - 1) }} data-testid="bulk-grid-prev-page">
              {t('pharmacy.inventory.bulk_edit.grid_prev_page')}
            </Button>
            <span data-testid="bulk-grid-page-info">
              {t('pharmacy.inventory.bulk_edit.grid_page_info', { page: page + 1, totalPages })}
            </span>
            <Button
              type="button"
              variant="ghost"
              disabled={page >= totalPages - 1 && !inventoryList.hasNextPage}
              onClick={() => { goToPage(page + 1) }}
              data-testid="bulk-grid-next-page"
            >
              {t('pharmacy.inventory.bulk_edit.grid_next_page')}
            </Button>
          </div>
        </>
      )}

      {hasEditPermission && (
        <Button
          type="button"
          disabled={!canSave}
          loading={bulkSave.isPending}
          onClick={handleSave}
          data-testid="bulk-grid-save-button"
        >
          {t('pharmacy.inventory.bulk_edit.grid_save')}
        </Button>
      )}

      {saveState === 'success' ? (
        <p role="status" data-testid="bulk-grid-save-success" className="text-sm text-ink">
          {t('pharmacy.inventory.bulk_edit.grid_save_success')}
        </p>
      ) : null}
      {saveState === 'error' ? (
        <p role="alert" data-testid="bulk-grid-save-error" className="text-sm text-brand-danger">
          {t('pharmacy.inventory.bulk_edit.grid_save_error')}
        </p>
      ) : null}
    </div>
  )
}
