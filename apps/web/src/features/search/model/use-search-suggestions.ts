/**
 * `use-search-suggestions.ts` (DTJ-192, `SRS-CAT-027`/`028`/`029`/`030`).
 *
 * Оркестрирует автодополнение: debounce сырого ввода, порог минимальной длины перед сетевым
 * запросом, и три источника подсказок (`SRS-CAT-030`):
 *   1. `q` пуст И локальная история непуста → история из `localStorage`, БЕЗ сети вообще.
 *   2. `q` пуст И история пуста → серверный trending-фолбэк (`fetchSuggestions('')`).
 *   3. `q` непуст (`>= MIN_SUGGEST_QUERY_LENGTH`) → обычный запрос автодополнения.
 *
 * **Гонка ответов (`SRS-CAT-027`, критерий приёмки DTJ-192 №2).** `queryKey` включает
 * `debouncedQuery` — TanStack Query держит РОВНО ОДИН активный результат для последнего ключа;
 * при смене ключа до завершения предыдущего запроса библиотека сама отменяет предыдущий через
 * `AbortController`, переданный `queryFn` в `{ signal }` — здесь он пробрасывается дальше в
 * `fetchSuggestions`/`httpGetJson` до реального `fetch`. Устаревший ответ либо не долетает
 * (аборт), либо TanStack Query игнорирует его как результат уже неактуального запроса — ручного
 * флага "актуальности" не требуется.
 *
 * **Минимальная длина запроса (по требованию тикета DTJ-192 — «продумай») —
 * `MIN_SUGGEST_QUERY_LENGTH = 2`.** SRS не фиксирует клиентский нижний порог явно (сервер
 * технически принимает и однобуквенный `q` через префиксный `ILIKE`, `SRS-DB-019`) — это
 * осознанное решение фронтенда для целевой аудитории «дешёвый Android + слабый интернет»
 * (`docs/spec/00-SRS-MASTER.md` `SRS-UX-009`): одна буква почти никогда не даёт релевantную
 * подсказку, но уже стоит одного сетевого запроса на медленном канале. Порог НЕ применяется к
 * пустому `q` — это отдельная ветка (trending/история), не «слишком короткий ввод».
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { HttpError } from '@/shared/api/http-client'
import { fetchSuggestions, type SuggestSuggestion } from '../api/search.api'
import { useDebouncedValue } from './use-debounced-value'
import { readSearchHistory } from './search-history'

/** `REQ-UX-12`/`SRS-CAT-027`: debounce 150–300мс — середина диапазона. */
export const SUGGEST_DEBOUNCE_MS = 250
/** См. JSDoc файла — решение фронтенда, не серверное ограничение. */
export const MIN_SUGGEST_QUERY_LENGTH = 2

export type SuggestSource = 'history' | 'network'

export interface UseSearchSuggestionsResult {
  readonly suggestions: readonly SuggestSuggestion[]
  readonly source: SuggestSource
  /** `true` только пока идёт РЕАЛЬНЫЙ сетевой запрос — не когда ждём debounce. */
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: HttpError | null
  /** `true`, когда ввод непуст, но короче `MIN_SUGGEST_QUERY_LENGTH` — запрос сознательно не отправлен. */
  readonly belowMinLength: boolean
}

function toHistorySuggestions(entries: readonly string[]): readonly SuggestSuggestion[] {
  return entries.map((tradeName) => ({ medicineId: null, tradeName, innName: null, matchedVia: 'history' as const }))
}

/** Вынесено отдельно — держит complexity `useSearchSuggestions` (C1) под порогом. */
function buildNetworkResult(
  shouldQueryNetwork: boolean,
  belowMinLength: boolean,
  query: UseQueryResult<readonly SuggestSuggestion[], HttpError>,
): UseSearchSuggestionsResult {
  if (!shouldQueryNetwork) {
    return { suggestions: [], source: 'network', isLoading: false, isError: false, error: null, belowMinLength }
  }
  return {
    suggestions: query.data ?? [],
    source: 'network',
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error ?? null,
    belowMinLength,
  }
}

/**
 * `enabled` — управляется вызывающим компонентом (`search-bar.tsx`): пока дропдаун закрыт
 * (инпут не в фокусе), сетевые запросы не нужны даже при непустом `rawQuery` в поле.
 */
export function useSearchSuggestions(rawQuery: string, enabled: boolean): UseSearchSuggestionsResult {
  const debouncedQuery = useDebouncedValue(rawQuery.trim(), SUGGEST_DEBOUNCE_MS)
  const isEmptyQuery = debouncedQuery.length === 0
  const belowMinLength = !isEmptyQuery && debouncedQuery.length < MIN_SUGGEST_QUERY_LENGTH

  const history = isEmptyQuery ? readSearchHistory() : []
  const useLocalHistory = isEmptyQuery && history.length > 0
  const shouldQueryNetwork = enabled && !belowMinLength && !useLocalHistory

  const query: UseQueryResult<readonly SuggestSuggestion[], HttpError> = useQuery({
    queryKey: ['search', 'suggest', debouncedQuery],
    queryFn: ({ signal }) => fetchSuggestions(debouncedQuery, signal),
    enabled: shouldQueryNetwork,
    staleTime: SUGGEST_DEBOUNCE_MS,
  })

  if (useLocalHistory) {
    return {
      suggestions: toHistorySuggestions(history),
      source: 'history',
      isLoading: false,
      isError: false,
      error: null,
      belowMinLength: false,
    }
  }

  return buildNetworkResult(shouldQueryNetwork, belowMinLength, query)
}
