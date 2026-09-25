/**
 * `cursor-table.spec.tsx` (DTJ-408, критерий приёмки 4, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { CursorTable, type CursorTableColumn } from './cursor-table'

afterEach(() => {
  cleanup()
})

interface Row {
  readonly id: string
  readonly name: string
}

const ROWS: readonly Row[] = [
  { id: '1', name: 'Парацетамол' },
  { id: '2', name: 'Ибупрофен' },
]

const COLUMNS: readonly CursorTableColumn<Row>[] = [
  { key: 'name', header: 'Название', render: (row) => row.name },
]

describe('CursorTable — рендер строк и заголовков', () => {
  it('рендерит th scope="col" для каждой колонки и renderItem для каждого элемента', () => {
    render(
      <CursorTable
        columns={COLUMNS}
        items={ROWS}
        getItemKey={(row) => row.id}
        nextCursor={null}
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
      />,
    )
    const header = screen.getByRole('columnheader', { name: 'Название' })
    expect(header).toHaveAttribute('scope', 'col')
    expect(screen.getByText('Парацетамол')).toBeInTheDocument()
    expect(screen.getByText('Ибупрофен')).toBeInTheDocument()
  })

  it('заголовки не теряются при горизонтальном скролле — overflow-x на обёртке, не на body', () => {
    const { container } = render(
      <CursorTable
        columns={COLUMNS}
        items={ROWS}
        getItemKey={(row) => row.id}
        nextCursor={null}
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
      />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(getComputedStyle(wrapper).overflowX).toBe('auto')
    expect(getComputedStyle(document.body).overflowX).not.toBe('auto')
  })
})

describe('CursorTable — кнопка «Показать ещё»', () => {
  it('скрыта, когда nextCursor === null', () => {
    render(
      <CursorTable
        columns={COLUMNS}
        items={ROWS}
        getItemKey={(row) => row.id}
        nextCursor={null}
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
      />,
    )
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('видна и вызывает onLoadMore по клику, когда nextCursor задан', () => {
    const onLoadMore = vi.fn()
    render(
      <CursorTable
        columns={COLUMNS}
        items={ROWS}
        getItemKey={(row) => row.id}
        nextCursor="cursor-1"
        onLoadMore={onLoadMore}
        loadMoreLabel="Показать ещё"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })
})

describe('CursorTable — пустое состояние', () => {
  it('рендерит emptyState вместо таблицы, если items пуст и emptyState передан', () => {
    render(
      <CursorTable
        columns={COLUMNS}
        items={[]}
        getItemKey={(row) => row.id}
        nextCursor={null}
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
        emptyState={<p>Ничего не найдено</p>}
      />,
    )
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('CursorTable — доступность', () => {
  it('нулевые critical/serious нарушения', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <CursorTable
        columns={COLUMNS}
        items={ROWS}
        getItemKey={(row) => row.id}
        nextCursor="cursor-1"
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
      />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
