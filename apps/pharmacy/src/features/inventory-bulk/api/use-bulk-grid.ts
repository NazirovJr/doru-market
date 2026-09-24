import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import type { ManualEntryRow, ManualEntryResponse, PharmacyInventoryItemDto } from '@dorutj/contracts'
import { httpPostJson, httpRequest, HttpError } from '@/shared/api/http-client'
import { INVENTORY_LIST_QUERY_KEY } from '@/shared/api/inventory-query-keys'

const BULK_ENTRY_PATH = '/api/v1/inventory-manual-entry'
const INVENTORY_LIST_PATH = '/api/v1/inventory'
export const BULK_GRID_PAGE_SIZE = 50
const DIRAM_PER_TJS = 100
const TJS_DECIMALS = 2

export interface BulkGridRow {
  readonly rowId: string
  readonly medicineId: string
  readonly medicineLabel: string
  readonly priceTjs: string
  readonly quantity: string
  readonly expiryDate: string
  readonly batchNumber: string
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

export function formatMedicineLabel(item: { tradeName: string; dosageForm: string; dosageStrength: string }): string {
  return `${item.tradeName} (${item.dosageForm}, ${item.dosageStrength})`
}

// Целые дирамы → строка TJS с 2 знаками, без float-деления (только для отображения).
function diramToTjsDisplay(priceDiram: number): string {
  const integerPart = Math.trunc(priceDiram / DIRAM_PER_TJS)
  const fractionPart = priceDiram % DIRAM_PER_TJS
  return `${String(integerPart)}.${String(fractionPart).padStart(TJS_DECIMALS, '0')}`
}

function toBulkGridRowFromServer(item: PharmacyInventoryItemDto): BulkGridRow {
  return {
    rowId: item.inventoryId,
    medicineId: item.medicineId,
    medicineLabel: formatMedicineLabel(item),
    priceTjs: diramToTjsDisplay(item.priceDiram),
    quantity: String(item.stockQuantity),
    expiryDate: item.expiryDate,
    batchNumber: item.batchNumber ?? '',
    isDirty: false,
  }
}

// Серверные строки — источник истины; локальные держатся, только пока isDirty и rowId не с сервера.
export function mergeServerAndLocalRows(
  serverRows: readonly BulkGridRow[],
  currentRows: readonly BulkGridRow[],
): readonly BulkGridRow[] {
  const serverRowIds = new Set(serverRows.map((row) => row.rowId))
  const localOnlyRows = currentRows.filter((row) => row.isDirty && !serverRowIds.has(row.rowId))
  return [...serverRows, ...localOnlyRows]
}

interface InventoryListPageResult {
  readonly items: readonly PharmacyInventoryItemDto[]
  readonly nextCursor: string | null
}

interface InventoryListEnvelope {
  readonly data: readonly PharmacyInventoryItemDto[]
  readonly meta?: { readonly pagination?: { readonly nextCursor: string | null } }
}
interface ErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string }
}

function parseInventoryListSuccess(text: string): InventoryListPageResult {
  const body = (text.length > 0 ? JSON.parse(text) : null) as InventoryListEnvelope
  return { items: body.data, nextCursor: body.meta?.pagination?.nextCursor ?? null }
}

function toInventoryListError(status: number, text: string): HttpError {
  const body = (text.length > 0 ? JSON.parse(text) : null) as ErrorEnvelope | null
  return new HttpError(status, body?.error?.code ?? 'UNKNOWN_ERROR', { message: body?.error?.message })
}

// httpRequestJson отбрасывает meta — курсору нужен meta.pagination.nextCursor, поэтому сырой httpRequest.
async function fetchInventoryPage(cursor: string | null): Promise<InventoryListPageResult> {
  const params = new URLSearchParams({ limit: String(BULK_GRID_PAGE_SIZE) })
  if (cursor !== null) {
    params.set('cursor', cursor)
  }
  const response = await httpRequest(`${INVENTORY_LIST_PATH}?${params.toString()}`)
  const text = await response.text()
  if (!response.ok) {
    throw toInventoryListError(response.status, text)
  }
  return parseInventoryListSuccess(text)
}

export function useInventoryList(): UseInfiniteQueryResult<InfiniteData<InventoryListPageResult>, HttpError> {
  return useInfiniteQuery<InventoryListPageResult, HttpError, InfiniteData<InventoryListPageResult>, typeof INVENTORY_LIST_QUERY_KEY, string | null>({
    queryKey: INVENTORY_LIST_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchInventoryPage(pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

export function flattenInventoryPages(data: InfiniteData<InventoryListPageResult> | undefined): readonly BulkGridRow[] {
  if (data === undefined) return []
  return data.pages.flatMap((page) => page.items.map(toBulkGridRowFromServer))
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

// Тот же эндпоинт, что точечное редактирование — массовая сетка не отдельный канал, а батч того же manual_entry.
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
