import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseCursorPaginationParams {
  /** Курсор следующей страницы (`SRS-API-004`) — `null` означает, что данные закончились. */
  readonly nextCursor: string | null
  /** Запрашивает следующую страницу у потребителя. Может быть асинхронной — хук ждёт её
   * завершения, прежде чем разрешить повторный вызов `loadMore`. */
  readonly onLoadMore: (cursor: string) => void | Promise<void>
}

export interface UseCursorPaginationResult {
  /** `true`, пока `nextCursor !== null` — потребитель показывает кнопку/триггер «Показать ещё». */
  readonly hasMore: boolean
  /** `true` между вызовом `onLoadMore` и его завершением — потребитель может дизейблить кнопку/
   * показать `Skeleton`-строки. */
  readonly isLoadingMore: boolean
  /** Запускает загрузку следующей страницы. Не делает ничего, если `nextCursor === null` или уже
   * идёт загрузка — защита от двойного параллельного запроса при быстром повторном клике/скролле. */
  readonly loadMore: () => void
}

/**
 * Общая логика курсорной пагинации `SRS-API-004` — переиспользуется `CursorTable` и `CursorList`
 * (единственное место с этой логикой, `AGENTS.md` C15). Домен-агностична: не знает, что именно
 * подгружается, только оперирует курсором и колбэком потребителя.
 *
 * ГРАНИЦА ПРОВЕРКИ (unit-уровень `jsdom`): тест здесь доказывает, что `loadMore` вызывает
 * `onLoadMore` ровно по правилам (наличие курсора, защита от параллельного вызова) — не проверяет
 * реальную бесконечную прокрутку/`IntersectionObserver` браузера, это остаётся на E2E.
 */
export function useCursorPagination({ nextCursor, onLoadMore }: UseCursorPaginationParams): UseCursorPaginationResult {
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const isLoadingRef = useRef(false)
  const isMountedRef = useRef(true)

  useEffect(
    () => (): void => {
      isMountedRef.current = false
    },
    [],
  )

  const loadMore = useCallback((): void => {
    if (nextCursor === null || isLoadingRef.current) {
      return
    }

    isLoadingRef.current = true
    setIsLoadingMore(true)

    void Promise.resolve(onLoadMore(nextCursor)).finally(() => {
      isLoadingRef.current = false
      if (isMountedRef.current) {
        setIsLoadingMore(false)
      }
    })
  }, [nextCursor, onLoadMore])

  return {
    hasMore: nextCursor !== null,
    isLoadingMore,
    loadMore,
  }
}
