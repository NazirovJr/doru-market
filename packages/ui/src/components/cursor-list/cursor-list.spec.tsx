import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { CursorList } from './cursor-list.js'

interface Offer {
  readonly id: string
  readonly name: string
}

const OFFERS: readonly Offer[] = [
  { id: '1', name: 'Парацетамол 500мг' },
  { id: '2', name: 'Ибупрофен 200мг' },
]

describe('CursorList — рендер renderItem на каждый элемент', () => {
  it('вызывает renderItem для каждого элемента items', () => {
    const renderItem = vi.fn((offer: Offer) => <span>{offer.name}</span>)
    render(
      <CursorList
        items={OFFERS}
        renderItem={renderItem}
        getItemKey={(offer) => offer.id}
        nextCursor={null}
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )

    expect(renderItem).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Парацетамол 500мг')).toBeInTheDocument()
    expect(screen.getByText('Ибупрофен 200мг')).toBeInTheDocument()
  })
})

describe('CursorList — кнопка «Показать ещё»', () => {
  it('nextCursor === null → кнопка не рендерится (скрыта)', () => {
    render(
      <CursorList
        items={OFFERS}
        renderItem={(offer) => <span>{offer.name}</span>}
        getItemKey={(offer) => offer.id}
        nextCursor={null}
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )

    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('nextCursor !== null → кнопка видна и вызывает onLoadMore с курсором по клику', () => {
    const onLoadMore = vi.fn()
    render(
      <CursorList
        items={OFFERS}
        renderItem={(offer) => <span>{offer.name}</span>}
        getItemKey={(offer) => offer.id}
        nextCursor="cursor-2"
        onLoadMore={onLoadMore}
        loadMoreLabel="Показать ещё"
      />,
    )

    const button = screen.getByRole('button', { name: 'Показать ещё' })
    fireEvent.click(button)

    expect(onLoadMore).toHaveBeenCalledWith('cursor-2')
  })

  it('во время загрузки кнопка переходит в состояние loading', async () => {
    let resolvePending: (() => void) | undefined
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePending = resolve
        }),
    )
    render(
      <CursorList
        items={OFFERS}
        renderItem={(offer) => <span>{offer.name}</span>}
        getItemKey={(offer) => offer.id}
        nextCursor="cursor-2"
        onLoadMore={onLoadMore}
        loadMoreLabel="Показать ещё"
      />,
    )

    // Ссылку на кнопку берём ДО клика: во время loading текст label получает `visibility:
    // hidden` (см. `Button`), из-за чего повторный `getByRole(..., { name })` по тексту перестаёт
    // находить элемент (accessible name вычисляется по видимому тексту) — это ожидаемое поведение
    // `Button.loading`, не регресс `CursorList`.
    const loadMoreButton = screen.getByRole('button', { name: 'Показать ещё' })
    fireEvent.click(loadMoreButton)
    await waitFor(() => expect(loadMoreButton).toHaveAttribute('aria-busy', 'true'))

    resolvePending?.()
  })

  it('skeletonRowCount>0 → во время загрузки показывает Skeleton-строки', async () => {
    let resolvePending: (() => void) | undefined
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePending = resolve
        }),
    )
    const { container } = render(
      <CursorList
        items={OFFERS}
        renderItem={(offer) => <span>{offer.name}</span>}
        getItemKey={(offer) => offer.id}
        nextCursor="cursor-2"
        onLoadMore={onLoadMore}
        loadMoreLabel="Показать ещё"
        skeletonRowCount={2}
      />,
    )

    expect(container.querySelectorAll('.ui-cursor-list__skeleton-row')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => {
      expect(container.querySelectorAll('.ui-cursor-list__skeleton-row')).toHaveLength(2)
    })

    resolvePending?.()
  })
})

describe('CursorList — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <CursorList
        items={OFFERS}
        renderItem={(offer) => <span>{offer.name}</span>}
        getItemKey={(offer) => offer.id}
        nextCursor="cursor-2"
        onLoadMore={() => undefined}
        loadMoreLabel="Показать ещё"
      />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
