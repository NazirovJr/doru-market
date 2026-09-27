/**
 * `LoadMoreButton` (DTJ-408) — общая кнопка «Показать ещё», переиспользуемая `CursorTable` и
 * `CursorList` (C15: одна кнопка пагинации, не две копии). Скрыта целиком, когда `nextCursor ===
 * null` (критерий приёмки 4 DTJ-408) — не просто `disabled`, чтобы не оставлять мёртвый элемент
 * в DOM/tab-order после конца списка.
 */
import { type ReactElement } from 'react'
import { Button } from '../button/button'
import { useCursorPagination } from './use-cursor-pagination'

export interface LoadMoreButtonProps {
  readonly nextCursor: string | null
  readonly isLoading: boolean
  readonly onLoadMore: () => void
  /** Текст кнопки — переводится потребителем (i18n-ключ `catalog.search.load_more` и аналоги). */
  readonly label: string
}

export const LoadMoreButton = ({
  nextCursor,
  isLoading,
  onLoadMore,
  label,
}: LoadMoreButtonProps): ReactElement | null => {
  const { handleLoadMore } = useCursorPagination({ nextCursor, isLoading, onLoadMore })

  if (nextCursor === null) {
    return null
  }

  return (
    <Button variant="secondary" onClick={handleLoadMore} loading={isLoading}>
      {label}
    </Button>
  )
}
