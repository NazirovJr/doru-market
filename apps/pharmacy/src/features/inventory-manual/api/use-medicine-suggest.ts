import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { SearchResultItemDto } from '@dorutj/contracts'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'

/** `/search`, а не `/suggest`: только он отдаёт форму и дозировку, нужные для различения позиций. */
const MEDICINE_SEARCH_PATH = '/api/v1/medicines/search'
const MEDICINE_SEARCH_RESULT_LIMIT = 8
export const MIN_MEDICINE_QUERY_LENGTH = 2
/** Повторный выбор того же запроса (напр. blur+focus) не бьёт по сети заново на 30с. */
const SUGGEST_STALE_TIME_MS = 30_000

export interface MedicineSuggestionItem {
  readonly medicineId: string
  readonly tradeName: string
  readonly dosageForm: string
  readonly dosageStrength: string
}

function toSuggestionItem(item: SearchResultItemDto): MedicineSuggestionItem {
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

async function fetchMedicineSuggestions(text: string): Promise<readonly MedicineSuggestionItem[]> {
  const items = await httpRequestJson<readonly SearchResultItemDto[]>(buildSearchPath(text))
  return items.map(toSuggestionItem)
}

export function useMedicineSuggest(
  debouncedQuery: string,
  enabled: boolean,
): UseQueryResult<readonly MedicineSuggestionItem[], HttpError> {
  const belowMinLength = debouncedQuery.length < MIN_MEDICINE_QUERY_LENGTH
  return useQuery<readonly MedicineSuggestionItem[], HttpError>({
    queryKey: ['inventory-manual', 'medicine-search', debouncedQuery],
    queryFn: () => fetchMedicineSuggestions(debouncedQuery),
    enabled: enabled && !belowMinLength,
    staleTime: SUGGEST_STALE_TIME_MS,
  })
}
