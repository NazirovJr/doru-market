import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InventoryPage from './InventoryPage'

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))))
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <InventoryPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** DTJ-167 «Что сделать» п.5: переключатель вкладок «Точечное редактирование» / «Массовое редактирование». */
describe('<InventoryPage /> (DTJ-167)', () => {
  it('по умолчанию открыта вкладка «Точечное редактирование» — форма видна', () => {
    stubFetch()
    renderPage()
    expect(screen.getByTestId('point-edit-form')).toBeInTheDocument()
    expect(screen.queryByTestId('inventory-bulk-edit-stub')).not.toBeInTheDocument()
  })

  it('переключение на «Массовое редактирование» — заглушка до DTJ-168, форма точечного ввода скрыта', () => {
    stubFetch()
    renderPage()
    fireEvent.click(screen.getByTestId('inventory-tab-bulk-edit'))
    expect(screen.getByTestId('inventory-bulk-edit-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('point-edit-form')).not.toBeInTheDocument()
  })
})
