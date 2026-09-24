import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { SearchResultItemDto } from '@dorutj/contracts'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'

/**
 * Локальная копия поиска медикамента для сетки массового редактирования — тот же реальный
 * эндпоинт `catalog`-модуля, что `features/inventory-manual/api/use-medicine-suggest.ts`
 * (DTJ-167), НЕ импортируется оттуда напрямую: горизонтальные импорты между фичами запрещены
 * (`docs/05-DEVELOPER-HANDBOOK.md` §6 «Фронтенд»), а `entities`-слоя в `apps/pharmacy` нет.
 */
const MEDICINE_SEARCH_PATH = '/api/v1/medicines/search'
const MEDICINE_SEARCH_RESULT_LIMIT = 8
export const MIN_BULK_MEDICINE_QUERY_LENGTH = 2
const SUGGEST_STALE_TIME_MS = 30_000

export interface BulkMedicineSuggestion {
  readonly medicineId: string
  readonly tradeName: string
  readonly dosageForm: string
  readonly dosageStrength: string
}

function toSuggestion(item: SearchResultItemDto): BulkMedicineSuggestion {
  return {
    medicineId: item.medicineId,
    tradeName: item.tradeName,
    dosageForm: item.dosageForm,
    dosageStrength: item.dosageStrength,
  }
}

function buildSearchPath(text: string): string {
  const params = new URLSearchParams({ text, limit: String(MEDICINE_SEARCH_RESULT_LIMIT) })
  return `${MEDICINE_SEARCH_PATH}?${params.toString()}`
}

async function fetchSuggestions(text: string): Promise<readonly BulkMedicineSuggestion[]> {
  const items = await httpRequestJson<readonly SearchResultItemDto[]>(buildSearchPath(text))
  return items.map(toSuggestion)
}

export function useBulkMedicineSearch(debouncedQuery: string, enabled: boolean): UseQueryResult<readonly BulkMedicineSuggestion[], HttpError> {
  const belowMinLength = debouncedQuery.length < MIN_BULK_MEDICINE_QUERY_LENGTH
  return useQuery<readonly BulkMedicineSuggestion[], HttpError>({
    queryKey: ['inventory-bulk', 'medicine-search', debouncedQuery],
    queryFn: () => fetchSuggestions(debouncedQuery),
    enabled: enabled && !belowMinLength,
    staleTime: SUGGEST_STALE_TIME_MS,
  })
}

export function formatBulkMedicineLabel(item: BulkMedicineSuggestion): string {
  return `${item.tradeName} (${item.dosageForm}, ${item.dosageStrength})`
}
