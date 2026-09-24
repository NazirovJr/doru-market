import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type {
  InventoryExcelImportAcceptedResponse,
  InventoryExcelImportMode,
  InventorySyncBatchesByUploadResponse,
} from '@dorutj/contracts'
import { httpPostForm, httpRequest, httpRequestJson, type HttpError } from '@/shared/api/http-client'
import { INVENTORY_LIST_QUERY_KEY } from '@/shared/api/inventory-query-keys'
import { computeAggregateProgress, type AggregateProgress } from '@/features/inventory-bulk/model/import-progress.model'

const EXCEL_IMPORT_PATH = '/api/v1/inventory-excel-import'
const IMPORT_TEMPLATE_PATH = '/api/v1/inventory-import-template'
const IMPORT_TEMPLATE_FILENAME = 'doru-tj-inventory-template.xlsx'
const ERROR_REPORT_FILENAME = 'doru-tj-inventory-import-errors.xlsx'
/** Опрос агрегированного статуса (риски тикета — «частая утечка TanStack Query»). */
export const IMPORT_POLL_INTERVAL_MS = 2000

interface ExcelImportInput {
  readonly file: File
  readonly mode: InventoryExcelImportMode
}

function uploadStatusPath(sourceUploadId: string): string {
  return `/api/v1/inventory-sync-batches/upload/${sourceUploadId}`
}

function errorReportPath(sourceUploadId: string): string {
  return `/api/v1/inventory-sync-batches/${sourceUploadId}/error-report`
}

async function postExcelImport(input: ExcelImportInput): Promise<InventoryExcelImportAcceptedResponse> {
  const formData = new FormData()
  formData.append('file', input.file)
  formData.append('mode', input.mode)
  return httpPostForm<InventoryExcelImportAcceptedResponse>(EXCEL_IMPORT_PATH, formData)
}

/** Инвалидирует список остатков — АС6 тикета: после импорта пользователь идёт проверять `/search`. */
export function useExcelImport(): UseMutationResult<InventoryExcelImportAcceptedResponse, HttpError, ExcelImportInput> {
  const queryClient = useQueryClient()
  return useMutation<InventoryExcelImportAcceptedResponse, HttpError, ExcelImportInput>({
    mutationKey: ['inventory', 'excel-import'],
    retry: 0,
    mutationFn: postExcelImport,
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_LIST_QUERY_KEY })
    },
  })
}

/**
 * Опрос статусов ВСЕХ батчей одной загрузки (ДОПОЛНЕНО DTJ-168 на бэкенде — `GET
 * .../upload/:sourceUploadId`, см. риски тикета «DTJ-163 не предусмотрел фильтр»).
 * `refetchInterval` выключается сам, как только `computeAggregateProgress` даёт `isComplete`
 * (DoD тикета — без этого опрос продолжался бы бесконечно).
 */
export function useImportBatchesPolling(sourceUploadId: string | null): UseQueryResult<InventorySyncBatchesByUploadResponse, HttpError> {
  return useQuery<InventorySyncBatchesByUploadResponse, HttpError>({
    queryKey: ['inventory', 'excel-import', 'batches', sourceUploadId],
    queryFn: () => httpRequestJson<InventorySyncBatchesByUploadResponse>(uploadStatusPath(sourceUploadId ?? '')),
    enabled: sourceUploadId !== null,
    refetchInterval: (query) => {
      const batches = query.state.data
      if (batches === undefined) return IMPORT_POLL_INTERVAL_MS
      return computeAggregateProgress(batches).isComplete ? false : IMPORT_POLL_INTERVAL_MS
    },
  })
}

export function progressFromBatches(batches: InventorySyncBatchesByUploadResponse | undefined): AggregateProgress {
  return computeAggregateProgress(batches ?? [])
}

async function triggerBlobDownload(path: string, filename: string): Promise<void> {
  const response = await httpRequest(path)
  if (!response.ok) {
    throw new Error(`Failed to download ${path}: HTTP ${String(response.status)}`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.click()
  URL.revokeObjectURL(objectUrl)
}

/** Прямая ссылка была бы проще, но не донесла бы `Authorization` до защищённого эндпоинта (см. «Что сделать» п.2 тикета). */
export function downloadInventoryImportTemplate(): Promise<void> {
  return triggerBlobDownload(IMPORT_TEMPLATE_PATH, IMPORT_TEMPLATE_FILENAME)
}

export function downloadImportErrorReport(sourceUploadId: string): Promise<void> {
  return triggerBlobDownload(errorReportPath(sourceUploadId), ERROR_REPORT_FILENAME)
}
