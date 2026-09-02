/**
 * `search-results.api.ts` (DTJ-193, `SRS-CAT-011/018/077`, `TC-CAT-025`).
 *
 * Единственная точка входа в сеть для экрана результатов поиска — `GET /api/v1/medicines/search`
 * (DTJ-190). Контракт ответа — `SearchResultItemDto` из `@dorutj/contracts` (`packages/contracts/
 * src/search.ts`), не переизобретён локально: в отличие от `search.api.ts` (DTJ-192, ветка
 * `/medicines/suggest`), эта форма ответа ПОЛНОСТЬЮ покрыта пакетом контрактов — сверено с
 * `apps/api/.../presentation/mappers/search-result.mapper.ts` (`toSearchResultItemDto`) построчно.
 *
 * Пагинация — курсорная (`SRS-API-004/005`): страница элементов приходит в `data`, `nextCursor`/
 * `hasMore` — в `meta.pagination` конверта (`CatalogSearchController.search`: `ok(items,
 * { pagination })`). `httpGetJson` (DTJ-192/199) отбрасывает `meta` — этот тикет первый, кому
 * реально нужна пагинация на фронте, поэтому используется `httpGetJsonWithMeta` (расширение
 * `shared/api/http-client.ts`, тот же приём, что DTJ-192 добавил `signal` третьим параметром —
 * не второй способ ходить в сеть, а расширение единственного существующего).
 *
 * `text=''` — валидный режим API «браузинг по фильтрам» (`SRS-CAT-045`), но `SearchBar`
 * (DTJ-192) никогда не ведёт на `/search` с пустым текстом (`goToResults` возвращает раньше без
 * навигации) — UI-фильтры каталога (радиус/цена/сортировка) вне объёма этого тикета, поэтому
 * `fetchSearchResults` параметризован только `text`+`cursor`, без `filters`/`geo`/`sort`.
 */
import type { SearchResultItemDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, type JsonMeta } from '@/shared/api/http-client'

const SEARCH_PATH = '/api/v1/medicines/search'

export interface SearchResultsPage {
  readonly items: readonly SearchResultItemDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

/** Форма `meta.pagination`, реально приходящая с сервера (`PaginationMeta`, `@dorutj/contracts`). */
interface SearchPaginationMeta {
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

function isSearchPaginationMeta(value: unknown): value is SearchPaginationMeta {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { readonly nextCursor?: unknown; readonly hasMore?: unknown }
  return (typeof candidate.nextCursor === 'string' || candidate.nextCursor === null) && typeof candidate.hasMore === 'boolean'
}

/** `meta` — непрозрачный `JsonMeta` на уровне `shared/api` (см. его JSDoc) — здесь распаковывается под конкретную форму этого эндпоинта. */
function readPagination(meta: JsonMeta | undefined): SearchPaginationMeta | null {
  const pagination = meta?.pagination
  return isSearchPaginationMeta(pagination) ? pagination : null
}

export async function fetchSearchResults(
  text: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<SearchResultsPage> {
  const envelope = await httpGetJsonWithMeta<readonly SearchResultItemDto[]>(SEARCH_PATH, { text, cursor }, signal)
  const pagination = readPagination(envelope.meta)
  return {
    items: envelope.data,
    nextCursor: pagination?.nextCursor ?? null,
    hasMore: pagination?.hasMore ?? false,
  }
}
