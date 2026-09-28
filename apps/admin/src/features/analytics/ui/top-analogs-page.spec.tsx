import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@dorutj/ui'
import { TopAnalogsPage } from './top-analogs-page'

vi.mock('@/shared/auth/current-role', () => ({ getCurrentTenantId: () => 'tenant-1' }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

// страница теперь рендерит ReportExportButton (useToast()) — обёрнута ToastProvider.
function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider closeButtonLabel="close">
        <TopAnalogsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const TOP_ANALOGS_BODY = [
  { medicineId: 'med-1', medicineName: 'Панадол', avgSavingsDiram: 2_000, timesShown: 50, conversionToOrder: 0.1 },
  { medicineId: 'med-2', medicineName: 'Аспирин', avgSavingsDiram: 1_000, timesShown: 5, conversionToOrder: 0.02 },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TopAnalogsPage (DTJ-383)', () => {
  it('рендерит по строке на медикамент с названием, экономией, показами и конверсией', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: TOP_ANALOGS_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('top-analogs-row')).toHaveLength(2) })
    expect(screen.getByText('Панадол')).toBeInTheDocument()
    expect(screen.getByText('Аспирин')).toBeInTheDocument()
  })

  it('пустой отчёт — сообщение "нет данных", без таблицы/падения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryByTestId('top-analogs-table')).not.toBeInTheDocument()
  })

  it('переключение периода на "Неделя" запускает новый запрос с форматом YYYY-Www', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: TOP_ANALOGS_BODY }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    fireEvent.click(screen.getByRole('tab', { name: 'Неделя' }))

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    const secondCall = fetchMock.mock.calls[1] as [string]
    const url = new URL(secondCall[0])
    expect(url.searchParams.get('period')).toMatch(/^\d{4}-W\d{2}$/)
  })

  it('ошибка загрузки — alert, без падения компонента', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
