import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { ManualEntryRow, ManualEntryResponse } from '@dorutj/contracts'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { INVENTORY_LIST_QUERY_KEY } from '@/shared/api/inventory-query-keys'

const BULK_ENTRY_PATH = '/api/v1/inventory-manual-entry'
/** SRS-INV-015 п.б — «практически кабинет пагинирует сетку», 50-100 строк на экран (DTJ-168 «Что сделать» п.1). */
export const BULK_GRID_PAGE_SIZE = 50

export interface BulkGridRow {
  readonly rowId: string
  readonly medicineId: string
  readonly medicineLabel: string
  readonly priceTjs: string
  readonly quantity: string
  readonly expiryDate: string
  readonly batchNumber: string
  /** Новая строка ИЛИ изменённая после загрузки — только такие попадают в `POST` при «Сохранить» (АС5). */
  readonly isDirty: boolean
}

interface BulkSaveRequestBody {
  readonly rows: readonly ManualEntryRow[]
}

export function isRowPriceValid(raw: string): boolean {
  const value = Number(raw)
  return raw.trim().length > 0 && Number.isFinite(value) && value > 0
}

export function isRowQuantityValid(raw: string): boolean {
  const value = Number(raw)
  return raw.trim().length > 0 && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

export function isRowExpiryValid(expiryDate: string, todayIso: string): boolean {
  return expiryDate.length > 0 && expiryDate >= todayIso
}

export function isRowValid(row: BulkGridRow, todayIso: string): boolean {
  return isRowPriceValid(row.priceTjs) && isRowQuantityValid(row.quantity) && isRowExpiryValid(row.expiryDate, todayIso)
}

/** АС5 — «Сохранить» отправляет ТОЛЬКО изменённые строки, не весь грид. */
export function selectDirtyRows(rows: readonly BulkGridRow[]): readonly BulkGridRow[] {
  return rows.filter((row) => row.isDirty)
}

export function totalPageCount(rowCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(rowCount / pageSize))
}

export function paginateRows(rows: readonly BulkGridRow[], page: number, pageSize: number): readonly BulkGridRow[] {
  const start = page * pageSize
  return rows.slice(start, start + pageSize)
}

function toManualEntryRow(row: BulkGridRow): ManualEntryRow {
  const base: ManualEntryRow = {
    medicineId: row.medicineId,
    priceTjs: Number(row.priceTjs),
    quantity: Number(row.quantity),
    expiryDate: row.expiryDate,
    op: 'upsert',
  }
  const trimmedBatch = row.batchNumber.trim()
  return trimmedBatch.length > 0 ? { ...base, batchNumber: trimmedBatch } : base
}

/** Переиспользует ТОТ ЖЕ backend-эндпоинт, что точечное редактирование (DTJ-162) — массовая сетка не отдельный канал, а батч того же `manual_entry`. */
export function useBulkSave(): UseMutationResult<ManualEntryResponse, HttpError, readonly BulkGridRow[]> {
  const queryClient = useQueryClient()
  return useMutation<ManualEntryResponse, HttpError, readonly BulkGridRow[]>({
    mutationKey: ['inventory', 'bulk-save'],
    retry: 0,
    mutationFn: (dirtyRows: readonly BulkGridRow[]): Promise<ManualEntryResponse> => {
      const body: BulkSaveRequestBody = { rows: dirtyRows.map(toManualEntryRow) }
      return httpPostJson<ManualEntryResponse>(BULK_ENTRY_PATH, body)
    },
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_LIST_QUERY_KEY })
    },
  })
}
