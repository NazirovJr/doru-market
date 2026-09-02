/**
 * `use-search-results.ts` (DTJ-193, `SRS-CAT-011/075/077`, `TC-CAT-025`).
 *
 * `useInfiniteQuery` поверх `fetchSearchResults` — курсорная "дозагрузка" (`SRS-API-004/005`):
 * `getNextPageParam` берёт `nextCursor` последней страницы, `undefined`, когда `hasMore=false`
 * (TanStack Query сам держит `hasNextPage=false`, дальше грузить нечего).
 *
 * **Деградация поиска (`SRS-CAT-075`, `TC-CAT-025`) — ОТДЕЛЬНОЕ состояние, не общая ошибка.**
 * `DomainExceptionFilter` (`apps/api/src/common/http/filters/domain-exception.filter.ts`,
 * прочитан целиком для этого тикета) для ЛЮБОГО HTTP-статуса `>=500` подменяет `error.code` на
 * `INTERNAL_ERROR` и `details` на `{requestId}` ДО того, как тело покидает сервер —
 * `details.reason='search_temporarily_degraded'` (`SearchServiceUnavailableError`, DTJ-190)
 * физически НЕ долетает до клиента при текущей реализации фильтра (см. JSDoc
 * `apps/api/.../catalog/presentation/errors/search-service-unavailable.error.ts`, раздел
 * «Известное ограничение» — подтверждено чтением фильтра, не предположение). Единственный
 * сигнал, доживающий до клиента, — реальный HTTP-статус `503` (`HttpError.status`, взятый из
 * `response.status`, не из тела, `shared/api/http-client.ts`) — `isSearchDegradedError` ниже
 * проверяет ИМЕННО его. `GET /medicines/search` сегодня не возвращает `503` ни по какой другой
 * причине (единственный источник — `SearchServiceUnavailableError` в
 * `CatalogSearchController.search`), так что проверка статуса уже корректна и достаточна; если
 * фильтр когда-нибудь починят, проверку `details.reason` можно добавить ДОПОЛНИТЕЛЬНО, не взамен.
 *
 * `retry: 0` — тот же приём, что `use-pharmacy-map-pins.ts`/`map-page.tsx`: повтор — по явному
 * действию пользователя (кнопка «Повторить»), не автоматический (иначе баннер деградации/ошибки
 * появился бы с задержкой в несколько попыток вместо сразу).
 */
import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query'
import type { SearchResultItemDto } from '@dorutj/contracts'
import type { HttpError } from '@/shared/api/http-client'
import { fetchSearchResults, type SearchResultsPage } from '../api/search-results.api'

const HTTP_STATUS_SERVICE_UNAVAILABLE = 503

/** См. JSDoc файла — статус, не тело, единственный надёжный сигнал деградации сегодня. */
export function isSearchDegradedError(error: HttpError): boolean {
  return error.status === HTTP_STATUS_SERVICE_UNAVAILABLE
}

export interface UseSearchResultsResult {
  readonly items: readonly SearchResultItemDto[]
  readonly isInitialLoading: boolean
  readonly isFetchingNextPage: boolean
  readonly hasNextPage: boolean
  readonly error: HttpError | null
  readonly isDegraded: boolean
  readonly fetchNextPage: () => void
  readonly refetch: () => void
}

/** Непустой `text` — обязательное условие запроса: пустой ввод в этом тикете не браузит каталог (см. JSDoc `search-results.api.ts`). */
export function useSearchResults(text: string): UseSearchResultsResult {
  const trimmed = text.trim()

  const query: UseInfiniteQueryResult<{ pages: SearchResultsPage[] }, HttpError> = useInfiniteQuery({
    queryKey: ['search', 'results', trimmed],
    queryFn: ({ pageParam, signal }) => fetchSearchResults(trimmed, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: SearchResultsPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    enabled: trimmed.length > 0,
    retry: 0,
  })

  const error = query.error ?? null

  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    isInitialLoading: query.isPending && trimmed.length > 0,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    error,
    isDegraded: error !== null && isSearchDegradedError(error),
    fetchNextPage: () => {
      void query.fetchNextPage()
    },
    refetch: () => {
      void query.refetch()
    },
  }
}
