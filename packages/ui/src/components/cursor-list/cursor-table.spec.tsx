import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { CursorTable, type CursorTableColumn } from './cursor-table.js'

interface Order {
  readonly id: string
  readonly number: string
  readonly totalSomoni: number
}

const ORDERS: readonly Order[] = [
  { id: '1', number: 'ORD-001', totalSomoni: 150 },
  { id: '2', number: 'ORD-002', totalSomoni: 80 },
]

const COLUMNS: readonly CursorTableColumn<Order>[] = [
  { id: 'number', header: 'Номер заказа', renderCell: (order) => order.number },
  { id: 'total', header: 'Сумма', renderCell: (order) => `${String(order.totalSomoni)} сомони` },
]

describe('CursorTable — заголовки и содержимое', () => {
  it('рендерит <th scope="col"> для каждого заголовка колонки', () => {
    render(
      <CursorTable
        items={ORDERS}
        columns={COLUMNS}
        getItemKey={(order) => order.id}
        nextCursor={null}
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )

    const numberHeader = screen.getByRole('columnheader', { name: 'Номер заказа' })
    expect(numberHeader).toHaveAttribute('scope', 'col')
    expect(screen.getByRole('columnheader', { name: 'Сумма' })).toHaveAttribute('scope', 'col')
  })

  it('рендерит renderCell для каждого элемента и колонки', () => {
    render(
      <CursorTable
        items={ORDERS}
        columns={COLUMNS}
        getItemKey={(order) => order.id}
        nextCursor={null}
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )

    expect(screen.getByText('ORD-001')).toBeInTheDocument()
    expect(screen.getByText('150 сомони')).toBeInTheDocument()
    expect(screen.getByText('ORD-002')).toBeInTheDocument()
    expect(screen.getByText('80 сомони')).toBeInTheDocument()
  })
})

describe('CursorTable — обёртка со скроллом (AC4/SRS-UX-034)', () => {
  it('overflow-x:auto стоит на обёртке таблицы, а не на body', () => {
    // `jsdom` не применяет внешний CSS-файл к `getComputedStyle` — компонент дублирует
    // `overflow-x: auto` inline-стилем именно для проверки на этом уровне (см. `cursor-table.tsx`
    // `SCROLL_WRAPPER_STYLE`), класс `.ui-cursor-table__scroll` — источник истины в браузере.
    const { container } = render(
      <CursorTable
        items={ORDERS}
        columns={COLUMNS}
        getItemKey={(order) => order.id}
        nextCursor={null}
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )

    const scrollWrapper = container.querySelector<HTMLElement>('.ui-cursor-table__scroll')
    expect(scrollWrapper).not.toBeNull()
    expect(scrollWrapper?.contains(container.querySelector('table'))).toBe(true)
    expect(scrollWrapper?.style.overflowX).toBe('auto')
    expect(document.body.style.overflowX).not.toBe('auto')
  })
})

describe('CursorTable — «Показать ещё»', () => {
  it('nextCursor === null → кнопка не рендерится', () => {
    render(
      <CursorTable
        items={ORDERS}
        columns={COLUMNS}
        getItemKey={(order) => order.id}
        nextCursor={null}
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )

    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('nextCursor !== null → клик вызывает onLoadMore с курсором', () => {
    const onLoadMore = vi.fn()
    render(
      <CursorTable
        items={ORDERS}
        columns={COLUMNS}
        getItemKey={(order) => order.id}
        nextCursor="cursor-3"
        onLoadMore={onLoadMore}
        loadMoreLabel="Показать ещё"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(onLoadMore).toHaveBeenCalledWith('cursor-3')
  })

  it('caption рендерится, когда передан', () => {
    render(
      <CursorTable
        items={ORDERS}
        columns={COLUMNS}
        getItemKey={(order) => order.id}
        nextCursor={null}
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
        caption="Список заказов"
      />,
    )

    expect(screen.getByText('Список заказов')).toBeInTheDocument()
  })
})

describe('CursorTable — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <CursorTable
        items={ORDERS}
        columns={COLUMNS}
        getItemKey={(order) => order.id}
        nextCursor="cursor-3"
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
