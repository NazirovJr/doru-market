/**
 * `cursor-list.spec.tsx` (DTJ-408, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { CursorList } from './cursor-list'

afterEach(() => {
  cleanup()
})

interface Row {
  readonly id: string
  readonly name: string
}

const ROWS: readonly Row[] = [
  { id: '1', name: 'Аптека «Центральная»' },
  { id: '2', name: 'Аптека «Вечерняя»' },
]

describe('CursorList — рендер renderItem для каждого элемента', () => {
  it('рендерит renderItem для каждого элемента списка', () => {
    render(
      <CursorList
        items={ROWS}
        renderItem={(row) => row.name}
        getItemKey={(row) => row.id}
        nextCursor={null}
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
      />,
    )
    expect(screen.getByText('Аптека «Центральная»')).toBeInTheDocument()
    expect(screen.getByText('Аптека «Вечерняя»')).toBeInTheDocument()
  })
})

describe('CursorList — кнопка «Показать ещё»', () => {
  it('скрыта, когда nextCursor === null', () => {
    render(
      <CursorList
        items={ROWS}
        renderItem={(row) => row.name}
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
      <CursorList
        items={ROWS}
        renderItem={(row) => row.name}
        getItemKey={(row) => row.id}
        nextCursor="cursor-1"
        onLoadMore={onLoadMore}
        loadMoreLabel="Показать ещё"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('показывает состояние загрузки кнопки (aria-busy), пока isLoading=true', () => {
    render(
      <CursorList
        items={ROWS}
        renderItem={(row) => row.name}
        getItemKey={(row) => row.id}
        nextCursor="cursor-1"
        isLoading
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
      />,
    )
    // Текст «Показать ещё» визуально скрыт (`visibility: hidden`) на время загрузки — сам текст
    // остаётся в DOM (`Button` DTJ-404, сохраняет ширину), но не входит в accessible name кнопки,
    // поэтому кнопка ищется по единственности на странице, не по `name`.
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Показать ещё')).not.toBeVisible()
  })
})

describe('CursorList — пустое состояние', () => {
  it('рендерит emptyState вместо списка, если items пуст и emptyState передан', () => {
    render(
      <CursorList
        items={[]}
        renderItem={(row: Row) => row.name}
        getItemKey={(row: Row) => row.id}
        nextCursor={null}
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
        emptyState={<p>Список пуст</p>}
      />,
    )
    expect(screen.getByText('Список пуст')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('CursorList — доступность', () => {
  it('нулевые critical/serious нарушения', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <CursorList
        items={ROWS}
        renderItem={(row) => row.name}
        getItemKey={(row) => row.id}
        nextCursor="cursor-1"
        onLoadMore={vi.fn()}
        loadMoreLabel="Показать ещё"
      />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
