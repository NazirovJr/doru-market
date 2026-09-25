import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FunnelPage } from './funnel-page'

vi.mock('@/shared/auth/current-role', () => ({ getCurrentTenantId: () => 'tenant-1' }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <FunnelPage />
    </QueryClientProvider>,
  )
}

const FUNNEL_BODY = {
  searchPerformed: 500,
  analogShown: 100,
  analogClicked: 20,
  addedToCart: 15,
  orderPlaced: 10,
  conversionRates: { shownToClicked: 0.2, clickedToCart: 0.75, cartToOrder: 0.666_67, overallShownToOrder: 0.1 },
  totalSavingsShownDiram: 100_000,
  totalSavingsRealizedDiram: 15_000,
  weeklyTrend: [
    { weekLabel: '2026-07-27', realizedSavingsDiram: 500 },
    { weekLabel: '2026-08-03', realizedSavingsDiram: 1_000 },
  ],
}

const EMPTY_FUNNEL_BODY = {
  searchPerformed: 0,
  analogShown: 0,
  analogClicked: 0,
  addedToCart: 0,
  orderPlaced: 0,
  conversionRates: { shownToClicked: 0, clickedToCart: 0, cartToOrder: 0, overallShownToOrder: 0 },
  totalSavingsShownDiram: 0,
  totalSavingsRealizedDiram: 0,
  weeklyTrend: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FunnelPage', () => {
  it('рендерит 4 шага воронки и обе hero-карточки (абсолютное значение И процент одновременно, АС3)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: FUNNEL_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('funnel-hero-shown')).toBeInTheDocument() })
    expect(screen.getAllByTestId('funnel-step-row')).toHaveLength(4)
    expect(screen.getByTestId('funnel-hero-realized')).toHaveTextContent('150')
    expect(screen.getByTestId('funnel-hero-realized')).toHaveTextContent(/15\s*%/) // 15 000 / 100 000 сомони = 15%
    expect(screen.getByTestId('funnel-hero-shown')).toHaveTextContent('1 000')
  })

  it('переключение периода на "Неделя" запускает новый запрос с форматом YYYY-Www', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: FUNNEL_BODY }))
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

  it('АС2 — пустая воронка (все счётчики 0) — конверсии 0%, без NaN/падения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: EMPTY_FUNNEL_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('funnel-hero-shown')).toBeInTheDocument() })
    const realizedCard = screen.getByTestId('funnel-hero-realized').textContent
    expect(realizedCard).not.toMatch(/NaN|Infinity/)
    expect(screen.getByTestId('funnel-hero-realized')).toHaveTextContent(/0\s*%/)
  })
})
