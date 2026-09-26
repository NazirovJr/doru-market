/**
 * `CursorTable` (DTJ-408, `SRS-API-004`, `SRS-UX-034` «Таблицы») — табличное представление
 * курсорной пагинации. Домен-агностичен: конкретную форму строки данных передаёт потребитель
 * через `columns[].render`, компонент не знает, что именно рендерит (заказы/пользователи/аудит).
 *
 * Горизонтальный скролл — на ОБЁРТКЕ таблицы (`overflow-x: auto` на `<div>`, не на `<body>`
 * страницы), заголовки `<th scope="col">` остаются видимыми/семантичными при любой ширине
 * содержимого (критерий приёмки 4).
 */
import { type ReactElement, type ReactNode } from 'react'
import { LoadMoreButton } from './load-more-button'

export interface CursorTableColumn<TItem> {
  readonly key: string
  /** Текст заголовка колонки — переводится потребителем (i18n), не хардкод в компоненте. */
  readonly header: string
  readonly render: (item: TItem) => ReactNode
}

export interface CursorTableProps<TItem> {
  readonly columns: readonly CursorTableColumn<TItem>[]
  readonly items: readonly TItem[]
  readonly getItemKey: (item: TItem, index: number) => string
  /** `null` — страниц больше нет (`PaginationMeta.nextCursor`, `packages/contracts`). */
  readonly nextCursor: string | null
  readonly isLoading?: boolean
  readonly onLoadMore: () => void
  readonly loadMoreLabel: string
  readonly 'aria-label'?: string
  readonly emptyState?: ReactNode
}

const WRAPPER_STYLE = {
  boxSizing: 'border-box' as const,
  overflowX: 'auto' as const,
  border: '1px solid var(--brand-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--brand-surface)',
}

const TABLE_STYLE = {
  width: '100%',
  borderCollapse: 'collapse' as const,
  fontFamily: 'var(--brand-font-family)',
  fontSize: 'var(--font-size-sm)',
  color: 'var(--brand-text)',
}

const TH_STYLE = {
  textAlign: 'left' as const,
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--brand-border)',
  color: 'var(--brand-text-muted)',
  fontWeight: 'var(--font-weight-medium)',
  whiteSpace: 'nowrap' as const,
}

const TD_STYLE = {
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--brand-border)',
}

const FOOTER_STYLE = {
  display: 'flex',
  justifyContent: 'center',
  padding: 'var(--space-4)',
}

export const CursorTable = <TItem,>({
  columns,
  items,
  getItemKey,
  nextCursor,
  isLoading = false,
  onLoadMore,
  loadMoreLabel,
  'aria-label': ariaLabel,
  emptyState,
}: CursorTableProps<TItem>): ReactElement => {
  if (items.length === 0 && emptyState !== undefined) {
    return <>{emptyState}</>
  }

  return (
    <div style={WRAPPER_STYLE}>
      <table style={TABLE_STYLE} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" style={TH_STYLE}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={getItemKey(item, index)}>
              {columns.map((column) => (
                <td key={column.key} style={TD_STYLE}>
                  {column.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
