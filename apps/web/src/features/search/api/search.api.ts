/**
 * `search.api.ts` (DTJ-192, EP-06) — единственная точка входа в сеть для автодополнения поиска.
 *
 * Контракт ответа `GET /api/v1/medicines/suggest` списан НЕ с `@dorutj/contracts`
 * (`SuggestItemSchema` там описывает только подсказку, привязанную к медикаменту), а с
 * фактической presentation-формы бэкенда: `apps/api/.../mappers/search-result.mapper.ts`
 * (`SuggestResponseItemDto`) и `apps/api/.../controllers/catalog-search.controller.ts`
 * (`GET /medicines/suggest`, DTJ-190). Та форма — плоское расширение контракта с
 * `matchedVia: 'trending'` и nullable `medicineId`/`innName` для ветки без привязки к
 * конкретному медикаменту (`SRS-CAT-030`, пустой `q`) — контракт-пакет её не описывает.
 *
 * `signal` пробрасывается в `httpGetJson` (DTJ-192 расширил его третьим необязательным
 * параметром) — TanStack Query отменяет запрос устаревшего `queryKey` через этот сигнал
 * (`use-search-suggestions.ts`, `SRS-CAT-027`).
 */
import { httpGetJson } from '@/shared/api/http-client'

const SUGGEST_PATH = '/api/v1/medicines/suggest'
/** `SRS-CAT-027`: `GET /medicines/suggest?q=<text>&limit=10`. */
const SUGGEST_LIMIT = 10

/** Клиентское расширение серверного `matchedVia` — `'history'` никогда не приходит с сервера, это локальные записи из `localStorage` (`search-history.ts`). */
export type SuggestMatchedVia = 'prefix' | 'trigram' | 'inn' | 'trending' | 'history'

export interface SuggestSuggestion {
  readonly medicineId: string | null
  readonly tradeName: string
  readonly innName: string | null
  readonly matchedVia: SuggestMatchedVia
}

/** Форма, реально приходящая с сервера (без клиентского `'history'`) — см. JSDoc файла. */
interface SuggestResponseItem {
  readonly medicineId: string | null
  readonly tradeName: string
  readonly innName: string | null
  readonly matchedVia: 'prefix' | 'trigram' | 'inn' | 'trending'
}

export function fetchSuggestions(query: string, signal?: AbortSignal): Promise<readonly SuggestSuggestion[]> {
  return httpGetJson<readonly SuggestResponseItem[]>(
    SUGGEST_PATH,
    { q: query, limit: String(SUGGEST_LIMIT) },
    signal,
  )
}
