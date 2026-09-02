/**
 * `search-results-page.tsx` (DTJ-193, `SRS-CAT-011/018/077/075`, `TC-CAT-025`).
 *
 * Экран `/search?text=<query>` — единственный маршрут, на который ведёт `SearchBar` (DTJ-192,
 * `SRS-CAT-028`: переход всегда по имени, не по конкретному `medicine.id`). Переиспользует ГОТОВЫЙ
 * `SearchBar`/слой запросов автодополнения (DTJ-192) — второй такой же не заводится (зона этого
 * тикета — `GET /medicines/search`, а не `/medicines/suggest`).
 *
 * **Запрос в URL, а не в React state** (`?text=`, `useSearchParams`) — по требованию тикета:
 * (1) результат открывается по прямой ссылке и переживает обновление страницы (`F5` заново читает
 * `text` из URL, не теряет его); (2) `SearchBar` на этой же странице получает текущий запрос через
 * `initialQuery` (расширение `search-bar.tsx`, DTJ-193 — обратно совместимое: старые вызовы без
 * пропа продолжают работать как раньше) — уходя со страницы результатов и возвращаясь (браузерные
 * back/forward, ссылка), пользователь видит СВОЙ текст в поле поиска, а не пустое поле.
 *
 * **Состояния** (`resolveSearchResultsStatus`, тот же приём, что `resolveDropdownStatus` в
 * `search-bar.tsx`): `no-query` (URL без `text` — не тратим сетевой запрос впустую, `useSearchResults`
 * сам не запускает `useInfiniteQuery` для пустого текста), `loading`, `degraded` (`SRS-CAT-075`,
 * `TC-CAT-025` — ЧЕЛОВЕЧЕСКИЙ текст, отдельный от generic-ошибки, НЕ белый экран), `error`
 * (сетевая/прочая ошибка — переиспользует `ux.error.generic_500`/`ux.action.retry`, тот же стиль,
 * что `map-page.tsx`), `empty` (`SRS-CAT-077` — `data: []`, НЕ 404, `catalog.search.no_results`),
 * `ready` (список + кнопка «Загрузить ещё» при `hasNextPage`, курсорная пагинация DTJ-190).
 */
import { useCallback, type ReactElement } from 'react'
import { useSearchParams } from 'react-router'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import type { SearchResultItemDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { SearchBar } from '@/features/search/ui/search-bar'
import { SearchResultCard } from '@/features/search/ui/search-result-card'
import { useSearchResults, type UseSearchResultsResult } from '@/features/search/model/use-search-results'

const TEXT_PARAM = 'text'

type SearchResultsStatus = 'no-query' | 'loading' | 'degraded' | 'error' | 'empty' | 'ready'

function resolveSearchResultsStatus(hasQuery: boolean, result: UseSearchResultsResult): SearchResultsStatus {
  if (!hasQuery) {
    return 'no-query'
  }
  if (result.isInitialLoading) {
    return 'loading'
  }
  if (result.isDegraded) {
    return 'degraded'
  }
  if (result.error !== null) {
    return 'error'
  }
  return result.items.length === 0 ? 'empty' : 'ready'
}

interface StatusBannerProps {
  readonly status: SearchResultsStatus
  readonly t: TranslateFunction
  readonly onRetry: () => void
}

/** Баннер состояния — `null` для `ready` (список рендерит `SearchResultsList` отдельно). */
const SearchResultsStatusBanner = ({ status, t, onRetry }: StatusBannerProps): ReactElement | null => {
  if (status === 'no-query') {
    return (
      <p role="status" data-testid="search-results-no-query" className="p-4 text-center text-sm text-ink-muted">
        {t('catalog.search.no_query')}
      </p>
    )
  }
  if (status === 'loading') {
    return (
      <p role="status" data-testid="search-results-loading" className="p-4 text-center text-sm text-ink-muted">
        {t('catalog.search.loading')}
      </p>
    )
  }
  if (status === 'degraded') {
    return (
      <p role="alert" data-testid="search-results-degraded" className="p-4 text-center text-sm text-ink">
        {t('catalog.search.degraded')}
      </p>
    )
  }
  if (status === 'error') {
    return (
      <div role="alert" data-testid="search-results-error" className="flex flex-col items-center gap-2 p-4 text-center text-sm text-ink">
        <p>{t('ux.error.generic_500')}</p>
        <button
          type="button"
          data-testid="search-results-retry"
          onClick={onRetry}
          className="rounded-md bg-brand-primary px-3 py-1 font-semibold text-white"
        >
          {t('ux.action.retry')}
        </button>
      </div>
    )
  }
  if (status === 'empty') {
    return (
      <p role="status" data-testid="search-results-empty" className="p-4 text-center text-sm text-ink-muted">
        {t('catalog.search.no_results')}
      </p>
    )
  }
  return null
}

interface SearchResultsListProps {
  readonly items: readonly SearchResultItemDto[]
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
  readonly onLoadMore: () => void
  readonly t: TranslateFunction
}

const SearchResultsList = ({ items, hasNextPage, isFetchingNextPage, onLoadMore, t }: SearchResultsListProps): ReactElement => (
  <div data-testid="search-results-list">
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.medicineId}>
          <SearchResultCard item={item} t={t} />
        </li>
      ))}
    </ul>
    {hasNextPage ? (
      <button
        type="button"
        data-testid="search-results-load-more"
        onClick={onLoadMore}
        disabled={isFetchingNextPage}
        className="mt-3 w-full rounded-md border border-line py-2 text-sm font-medium text-ink disabled:opacity-50"
      >
        {t('catalog.search.load_more')}
      </button>
    ) : null}
  </div>
)

const SearchResultsPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [searchParams] = useSearchParams()
  const text = (searchParams.get(TEXT_PARAM) ?? '').trim()

  const result = useSearchResults(text)
  const status = resolveSearchResultsStatus(text.length > 0, result)

  const handleRetry = useCallback(() => {
    result.refetch()
  }, [result])

  const handleLoadMore = useCallback(() => {
    result.fetchNextPage()
  }, [result])

  return (
    <section className="flex flex-col gap-4" data-testid="search-results-page">
      <SearchBar initialQuery={text} />
      <SearchResultsStatusBanner status={status} t={t} onRetry={handleRetry} />
      {status === 'ready' ? (
        <SearchResultsList
          items={result.items}
          hasNextPage={result.hasNextPage}
          isFetchingNextPage={result.isFetchingNextPage}
          onLoadMore={handleLoadMore}
          t={t}
        />
      ) : null}
    </section>
  )
}

export default SearchResultsPage
