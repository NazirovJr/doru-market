import type { ReactElement, ReactNode } from 'react'
import { Button } from '../button/button.js'
import { Skeleton } from '../skeleton/skeleton.js'
import { cx } from '../shared/cx.js'
import { useCursorPagination } from './use-cursor-pagination.js'
import './cursor-list.css'

export interface CursorListProps<T> {
  readonly items: readonly T[]
  /** Форма строки списка домен-агностична — потребитель решает, карточка это или строка. */
  readonly renderItem: (item: T, index: number) => ReactNode
  readonly getItemKey: (item: T, index: number) => string | number
  /** Курсор следующей страницы (`SRS-API-004`), `null` — данных больше нет. */
  readonly nextCursor: string | null
  readonly onLoadMore: (cursor: string) => void | Promise<void>
  /** Текст кнопки «Показать ещё» — компонент не хардкодит строку, потребитель передаёт уже
   * переведённый текст (`useT`, `AGENTS.md` «ноль хардкода строк»). */
  readonly loadMoreLabel: string
  /** Число `Skeleton`-строк (DTJ-404), показываемых ПОД списком, пока идёт подгрузка следующей
   * страницы (`isLoadingMore`). `0` (по умолчанию) — скелетоны не показываются. */
  readonly skeletonRowCount?: number
  readonly className?: string
}

/**
 * Списочное представление курсорной пагинации `SRS-API-004` (`SRS-UX-021`). НЕ рисует собственное
 * пустое состояние при `items.length === 0` — это ответственность потребителя через композицию
 * (`EmptyState` из DTJ-406 передаётся снаружи), см. риск DTJ-409 в тикете.
 *
 * ГРАНИЦА ПРОВЕРКИ: unit-тест доказывает, что `renderItem` вызывается на каждый элемент и что
 * кнопка «Показать ещё» скрыта при `nextCursor === null` — настоящую бесконечную прокрутку/
 * виртуализацию `jsdom` не воспроизводит, это остаётся на E2E.
 */
export const CursorList = <T,>({
  items,
  renderItem,
  getItemKey,
  nextCursor,
  onLoadMore,
  loadMoreLabel,
  skeletonRowCount = 0,
  className,
}: CursorListProps<T>): ReactElement => {
  const { hasMore, isLoadingMore, loadMore } = useCursorPagination({ nextCursor, onLoadMore })

  return (
    <div className={cx('ui-cursor-list', className)}>
      <ul className="ui-cursor-list__items">
        {items.map((item, index) => (
          <li key={getItemKey(item, index)} className="ui-cursor-list__item">
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
      {isLoadingMore && skeletonRowCount > 0
        ? Array.from({ length: skeletonRowCount }, (_, skeletonIndex) => (
            <Skeleton key={`skeleton-${String(skeletonIndex)}`} variant="row" className="ui-cursor-list__skeleton-row" />
          ))
        : null}
      {hasMore ? (
        <Button
          type="button"
          variant="secondary"
          loading={isLoadingMore}
          onClick={loadMore}
          className="ui-cursor-list__load-more"
        >
          {loadMoreLabel}
        </Button>
      ) : null}
    </div>
  )
}
