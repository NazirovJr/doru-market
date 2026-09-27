/**
 * `useCursorPagination` (DTJ-408, `SRS-API-004`) — общая логика «загрузить следующую страницу»,
 * переиспользуемая `CursorTable` и `CursorList` (избегает дублирования по C15,
 * `docs/02-CLEAN-ARCHITECTURE-AND-CODE.md`).
 *
 * Курсорная пагинация (`packages/contracts/src/pagination.ts`, `PaginationMeta`) отдаёт
 * `nextCursor: string | null` — `null` означает «страниц больше нет». Хук НЕ делает fetch сам
 * (компонент домен-агностичен, запрос — обязанность потребителя через `onLoadMore`), а только:
 * 1. не вызывает `onLoadMore`, если `nextCursor === null` (страниц больше нет);
 * 2. защищает от повторного параллельного запроса при быстром повторном клике/скролле —
 *    `isLoading` персистентно приходит от потребителя (реальный ответ сети), но между кликом и
 *    перерисовкой потребителя с новым `isLoading` может пройти кадр — внутренний `pendingRef`
 *    закрывает это окно синхронно, до следующего рендера.
 *
 * НЕ импортирует `@dorutj/contracts`: `packages/ui` не объявляет его зависимостью (см. отчёт
 * тикета DTJ-408, ДОПУЩЕНИЯ) — тип `nextCursor: string | null` ниже структурно совместим с полем
 * `PaginationMeta.nextCursor` контракта, названия и форма совпадают намеренно.
 */
import { useCallback, useEffect, useRef } from 'react'

export interface UseCursorPaginationOptions {
  /** `null` — страниц больше нет (см. `PaginationMeta.nextCursor`, `packages/contracts`). */
  readonly nextCursor: string | null
  /** Идёт ли сейчас запрос следующей страницы (состояние потребителя, не хука). */
  readonly isLoading: boolean
  readonly onLoadMore: () => void
}

export interface UseCursorPaginationResult {
  /** `true`, когда есть что грузить и загрузка сейчас не идёт — управляет видимостью/disabled кнопки. */
  readonly canLoadMore: boolean
  /** Безопасный обработчик клика/скролла: гарантированно не вызовет `onLoadMore` дважды подряд. */
  readonly handleLoadMore: () => void
}

export const useCursorPagination = ({
  nextCursor,
  isLoading,
  onLoadMore,
}: UseCursorPaginationOptions): UseCursorPaginationResult => {
  const pendingRef = useRef(false)

  // `isLoading` — источник правды потребителя: как только он подтверждает завершение (или начало)
  // загрузки, синхронизируем внутренний флаг с ним, чтобы не залипнуть в `pending` навсегда, если
  // потребитель обновил `isLoading` без промежуточного вызова `handleLoadMore`.
  useEffect(() => {
    pendingRef.current = isLoading
  }, [isLoading])

  const handleLoadMore = useCallback((): void => {
    if (nextCursor === null || isLoading || pendingRef.current) {
      return
    }
    pendingRef.current = true
    onLoadMore()
  }, [nextCursor, isLoading, onLoadMore])

  return {
    canLoadMore: nextCursor !== null && !isLoading,
    handleLoadMore,
  }
}
