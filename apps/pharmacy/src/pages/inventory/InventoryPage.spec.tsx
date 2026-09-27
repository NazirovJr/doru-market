import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@dorutj/ui'
import { LocaleProvider } from '@/shared/config/locale-provider'
import InventoryPage from './InventoryPage'

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))))
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider closeButtonLabel="Закрыть">
          <InventoryPage />
        </ToastProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** DTJ-167 «Что сделать» п.5: переключатель вкладок «Точечное редактирование» / «Массовое редактирование». */
describe('<InventoryPage /> (DTJ-167/DTJ-168)', () => {
  it('по умолчанию открыта вкладка «Точечное редактирование» — форма видна', () => {
    stubFetch()
    renderPage()
    expect(screen.getByTestId('point-edit-form')).toBeInTheDocument()
    expect(screen.queryByTestId('inventory-bulk-edit-panel')).not.toBeInTheDocument()
  })

  it('переключение на «Массовое редактирование» — панель DTJ-168 (импорт + сетка) видна, форма точечного ввода скрыта', () => {
    stubFetch()
    renderPage()
    // `Tabs` (packages/ui) не принимает per-tab `data-testid` — клик по доступному имени таба (tj — дефолт локали).
    fireEvent.click(screen.getByRole('tab', { name: 'Таҳрири умумӣ' }))
    expect(screen.getByTestId('inventory-bulk-edit-panel')).toBeInTheDocument()
    expect(screen.getByTestId('excel-import-dropzone')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-edit-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('point-edit-form')).not.toBeInTheDocument()
  })
})
