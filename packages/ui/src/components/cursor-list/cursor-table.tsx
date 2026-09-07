import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Button } from '../button/button.js'
import { cx } from '../shared/cx.js'
import { useCursorPagination } from './use-cursor-pagination.js'
import './cursor-table.css'

/** `overflow-x: auto` продублирован inline-стилем поверх `.ui-cursor-table__scroll`
 * (`cursor-table.css`) по той же причине, что `Skeleton`/`Chip` дублируют CSS→inline: `jsdom` не
 * применяет реальный внешний stylesheet к `getComputedStyle` в unit-тестах (`vitest` по умолчанию
 * не инжектирует CSS в тестовый DOM) — inline-стиль делает AC4 проверяемым на unit-уровне, класс
 * остаётся источником истины для реального браузера. */
const SCROLL_WRAPPER_STYLE: CSSProperties = { overflowX: 'auto' }

export interface CursorTableColumn<T> {
  readonly id: string
  readonly header: string
  readonly renderCell: (item: T, index: number) => ReactNode
}

export interface CursorTableProps<T> {
  readonly items: readonly T[]
  readonly columns: readonly CursorTableColumn<T>[]
  readonly getItemKey: (item: T, index: number) => string | number
  /** Курсор следующей страницы (`SRS-API-004`), `null` — данных больше нет. */
  readonly nextCursor: string | null
  readonly onLoadMore: (cursor: string) => void | Promise<void>
  readonly loadMoreLabel: string
  /** `<caption>` для screen reader — необязателен, но рекомендуется при неочевидном контексте
   * таблицы (`SRS-UX-034`). */
  readonly caption?: string
  readonly className?: string
}

/**
 * Табличное представление курсорной пагинации `SRS-API-004` (`SRS-UX-034` таблица «Таблицы»).
 * Горизонтальный скролл — на ОБЁРТКЕ `.ui-cursor-table__scroll` (`cursor-table.css`), не на
 * `<body>`: `<th scope="col">` остаётся видимым/зафиксированным в контексте своей таблицы при
 * узком viewport и широком содержимом.
 *
 * ГРАНИЦА ПРОВЕРКИ: unit-тест проверяет DOM-структуру (`overflow-x` на правильном элементе,
 * `renderCell` на каждый элемент, видимость кнопки «Показать ещё») — реальное поведение скролла в
 * браузере (`overflow-x: auto` не считается layout-движком `jsdom`) остаётся на E2E.
 */
export const CursorTable = <T,>({
  items,
  columns,
  getItemKey,
  nextCursor,
  onLoadMore,
  loadMoreLabel,
  caption,
  className,
}: CursorTableProps<T>): ReactElement => {
  const { hasMore, isLoadingMore, loadMore } = useCursorPagination({ nextCursor, onLoadMore })

  return (
    <div className={cx('ui-cursor-table', className)}>
      <div className="ui-cursor-table__scroll" style={SCROLL_WRAPPER_STYLE}>
        <table className="ui-cursor-table__table">
          {caption !== undefined ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={getItemKey(item, index)}>
                {columns.map((column) => (
                  <td key={column.id}>{column.renderCell(item, index)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <Button
          type="button"
          variant="secondary"
          loading={isLoadingMore}
          onClick={loadMore}
          className="ui-cursor-table__load-more"
        >
          {loadMoreLabel}
        </Button>
      ) : null}
    </div>
  )
}
