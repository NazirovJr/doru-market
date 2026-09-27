/**
 * `CursorList` (DTJ-408, `SRS-API-004`) — списочное (не табличное) представление курсорной
 * пагинации: карточки/строки вместо колонок. Общая логика загрузки следующей страницы —
 * `use-cursor-pagination.ts` (переиспользуется `CursorTable`, C15).
 */
import { type ReactElement, type ReactNode } from 'react'
import { LoadMoreButton } from './load-more-button'

export interface CursorListProps<TItem> {
  readonly items: readonly TItem[]
  readonly renderItem: (item: TItem, index: number) => ReactNode
  readonly getItemKey: (item: TItem, index: number) => string
  /** `null` — страниц больше нет (`PaginationMeta.nextCursor`, `packages/contracts`). */
  readonly nextCursor: string | null
  readonly isLoading?: boolean
  readonly onLoadMore: () => void
  readonly loadMoreLabel: string
  readonly 'aria-label'?: string
  readonly emptyState?: ReactNode
}

const LIST_STYLE = {
  listStyle: 'none' as const,
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 'var(--space-3)',
}

const FOOTER_STYLE = {
  display: 'flex',
  justifyContent: 'center',
  paddingTop: 'var(--space-2)',
}

export const CursorList = <TItem,>({
  items,
  renderItem,
  getItemKey,
  nextCursor,
  isLoading = false,
  onLoadMore,
  loadMoreLabel,
  'aria-label': ariaLabel,
  emptyState,
}: CursorListProps<TItem>): ReactElement => {
  if (items.length === 0 && emptyState !== undefined) {
    return <>{emptyState}</>
  }

  return (
    <div>
      <ul aria-label={ariaLabel} style={LIST_STYLE}>
        {items.map((item, index) => (
          <li key={getItemKey(item, index)}>{renderItem(item, index)}</li>
        ))}
      </ul>
      <div style={FOOTER_STYLE}>
        <LoadMoreButton
          nextCursor={nextCursor}
          isLoading={isLoading}
          onLoadMore={onLoadMore}
          label={loadMoreLabel}
        />
      </div>
    </div>
  )
}
