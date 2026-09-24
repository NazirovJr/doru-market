import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { SearchResultItemDto } from '@dorutj/contracts'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'

/**
 * `use-medicine-suggest.ts` (DTJ-167, EP-05, SRS-INV-015) — каталожный автокомплит для
 * `MedicineAutocomplete.tsx`. НЕ файл из `files_owned` тикета буквально, но необходимая опора:
 * DTJ-167 «Что сделать» п.1 требует `TanStack Query` внутри `MedicineAutocomplete`, а
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §5 запрещает `fetch`/сетевые вызовы прямо в компоненте —
 * тонкий `api`-хук в ЭТОЙ ЖЕ, вновь создаваемой этим тикетом директории `features/inventory-manual/`
 * — не правка чужого `files_owned`, а обязательная часть первой реализации фичи (см. отчёт
 * тикета, ДОПУЩЕНИЯ).
 *
 * **`GET /api/v1/medicines/search`, а НЕ `/medicines/suggest`.** Тикет («Технический контекст»)
 * называет автокомплит поверх `GET /api/v1/medicines?search=...`, но реальный поисковый эндпоинт
 * (DTJ-190, `catalog-search.controller.ts`) — `/medicines/search` (полнотекстовый) и
 * `/medicines/suggest` (лёгкая подсказка). `/suggest` возвращает ТОЛЬКО `medicineId`/`tradeName`/
 * `innName`/`matchedVia` (`SuggestResponseItemDto`, `search-result.mapper.ts`) — БЕЗ
 * `dosageForm`/`dosageStrength`. Критерий приёмки 1 этого тикета требует показывать именно форму
 * выпуска/дозировку «для различения похожих позиций» — `/search` (`SearchResultItemDto`,
 * `@dorutj/contracts`) несёт оба поля 1:1, `/suggest` технически не может закрыть этот критерий.
 * Выбор `/search` — осознанное решение, а не невнимательность (см. риски тикета — сам тикет
 * предупреждает о неоднозначности «какой поиск уже готов»).
 *
 * `limit=8` — ASSUMPTION: тикет не фиксирует число подсказок числом, только «список» (критерий
 * приёмки 1); 8 — консервативный компромисс между «видно достаточно вариантов для различения
 * похожих позиций» и «не перегружать мобильный экран кабинета аптеки» (тот же порядок величины,
 * что `SUGGEST_DEFAULT_LIMIT=10` у `/suggest`, DTJ-190).
 */
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

/**
 * `enabled` — вызывающий компонент решает, когда сеть нужна (дропдаун открыт И медикамент ещё не
 * выбран, см. `MedicineAutocomplete.tsx`) — тот же приём, что `useSearchSuggestions` (`apps/web`).
 */
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
