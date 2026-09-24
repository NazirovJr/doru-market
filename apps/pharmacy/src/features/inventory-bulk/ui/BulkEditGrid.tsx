import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
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
import { useMedicineSuggest, type MedicineSuggestionItem } from '@/shared/api/use-medicine-search'

const MEDICINE_SEARCH_DEBOUNCE_MS = 200
const RANDOM_ID_RADIX = 36

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 'YYYY-MM-DD'.length)
}

function makeRowId(): string {
  return `bulk-row-${Math.random().toString(RANDOM_ID_RADIX).slice(2)}-${String(Date.now())}`
}

function useDebouncedText(rawQuery: string): string {
  const [debounced, setDebounced] = useState(rawQuery)
  useEffect(() => {
    const timeoutId = setTimeout(() => { setDebounced(rawQuery.trim()) }, MEDICINE_SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(timeoutId) }
  }, [rawQuery])
  return debounced
}

const MedicinePicker = ({
  onSelect,
  onCancel,
}: {
  readonly onSelect: (item: MedicineSuggestionItem) => void
  readonly onCancel: () => void
}): ReactElement => {
  const { t } = useT('tj')
  const [rawQuery, setRawQuery] = useState('')
  const debouncedQuery = useDebouncedText(rawQuery)
  const suggestQuery = useMedicineSuggest(debouncedQuery, true)
  const items = suggestQuery.data ?? []

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="bulk-grid-medicine-picker">
      <input
        type="text"
        autoFocus
        value={rawQuery}
        placeholder={t('pharmacy.inventory.autocomplete.placeholder')}
        data-testid="bulk-grid-medicine-picker-input"
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        onChange={(event) => { setRawQuery(event.target.value) }}
      />
      <ul data-testid="bulk-grid-medicine-picker-list" className="flex max-h-48 flex-col overflow-auto">
        {suggestQuery.isLoading ? <li className="text-sm text-ink-muted">{t('pharmacy.inventory.autocomplete.loading')}</li> : null}
        {!suggestQuery.isLoading && items.length === 0 ? (
          <li className="text-sm text-ink-muted">{t('pharmacy.inventory.autocomplete.empty')}</li>
        ) : null}
        {items.map((item) => (
          <li key={item.medicineId}>
            <button
              type="button"
              data-testid="bulk-grid-medicine-picker-option"
              onClick={() => { onSelect(item) }}
              className="w-full px-2 py-1 text-left text-sm hover:bg-line"
            >
              {formatMedicineLabel(item)}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCancel} data-testid="bulk-grid-medicine-picker-cancel" className="self-start text-xs text-ink-muted underline">
        {t('pharmacy.inventory.bulk_edit.grid_cancel_new_row')}
      </button>
    </div>
  )
}

const GridRow = ({
  row,
  today,
  onChange,
  onRemove,
}: {
  readonly row: BulkGridRow
  readonly today: string
  readonly onChange: (rowId: string, patch: Partial<BulkGridRow>) => void
  readonly onRemove: (rowId: string) => void
}): ReactElement => {
  const { t } = useT('tj')
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
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
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
          className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
          onChange={(event) => { onChange(row.rowId, { quantity: event.target.value }) }}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="date"
          value={row.expiryDate}
          data-testid="bulk-grid-expiry-input"
          aria-invalid={expiryInvalid}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
          onChange={(event) => { onChange(row.rowId, { expiryDate: event.target.value }) }}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="text"
          value={row.batchNumber}
          data-testid="bulk-grid-batch-input"
          className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
          onChange={(event) => { onChange(row.rowId, { batchNumber: event.target.value }) }}
        />
      </td>
      <td className="px-2 py-1">
        <button type="button" onClick={() => { onRemove(row.rowId) }} data-testid="bulk-grid-remove-row" className="text-xs text-brand-danger underline">
          {t('pharmacy.inventory.bulk_edit.grid_remove_row')}
        </button>
      </td>
    </tr>
  )
}

export const BulkEditGrid = (): ReactElement => {
  const { t } = useT('tj')
  const [rows, setRows] = useState<readonly BulkGridRow[]>([])
  const [page, setPage] = useState(0)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'success' | 'error'>('idle')
  const bulkSave = useBulkSave()
  const inventoryList = useInventoryList()
  const today = todayIsoDate()

  // Серверные строки — источник истины, локально добавленные/изменённые сохраняются поверх,
  // пока не сохранены (mergeServerAndLocalRows). Подгружаем все страницы сразу — существующий
  // пейджер сетки (BULK_GRID_PAGE_SIZE) остаётся клиентским поверх уже загруженных данных.
  const serverRows = flattenInventoryPages(inventoryList.data)
  useEffect(() => {
    setRows((prev) => mergeServerAndLocalRows(serverRows, prev))
  }, [inventoryList.data])
  useEffect(() => {
    if (inventoryList.hasNextPage && !inventoryList.isFetchingNextPage) {
      void inventoryList.fetchNextPage()
    }
  }, [inventoryList])

  const totalPages = totalPageCount(rows.length, BULK_GRID_PAGE_SIZE)
  const visibleRows = paginateRows(rows, page, BULK_GRID_PAGE_SIZE)
  const dirtyRows = selectDirtyRows(rows)
  const canSave = dirtyRows.length > 0 && dirtyRows.every((row) => isRowValid(row, today)) && !bulkSave.isPending

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

      <button
        type="button"
        onClick={() => { setIsPickerOpen(true) }}
        data-testid="bulk-grid-add-row-button"
        className="self-start rounded-md border border-brand-primary px-3 py-1 text-sm text-brand-primary"
      >
        {t('pharmacy.inventory.bulk_edit.grid_add_row')}
      </button>

      {isPickerOpen ? <MedicinePicker onSelect={handleAddMedicine} onCancel={() => { setIsPickerOpen(false) }} /> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="bulk-grid-empty">
          {t('pharmacy.inventory.bulk_edit.grid_empty')}
        </p>
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
                  <GridRow key={row.rowId} row={row} today={today} onChange={handleRowChange} onRemove={handleRemoveRow} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-ink-muted">
            <button type="button" disabled={page === 0} onClick={() => { setPage((p) => p - 1) }} data-testid="bulk-grid-prev-page" className="underline disabled:opacity-50">
              {t('pharmacy.inventory.bulk_edit.grid_prev_page')}
            </button>
            <span data-testid="bulk-grid-page-info">
              {t('pharmacy.inventory.bulk_edit.grid_page_info', { page: page + 1, totalPages })}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => { setPage((p) => p + 1) }}
              data-testid="bulk-grid-next-page"
              className="underline disabled:opacity-50"
            >
              {t('pharmacy.inventory.bulk_edit.grid_next_page')}
            </button>
          </div>
        </>
      )}

      <button
        type="button"
        disabled={!canSave}
        onClick={handleSave}
        data-testid="bulk-grid-save-button"
        className="inline-flex items-center justify-center self-start rounded-md bg-brand-primary px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {bulkSave.isPending ? t('pharmacy.inventory.bulk_edit.grid_save_pending') : t('pharmacy.inventory.bulk_edit.grid_save')}
      </button>

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
