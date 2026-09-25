import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlatformMetricsPage } from './platform-metrics-page'

vi.mock('@/shared/auth/current-role', () => ({ getCurrentTenantId: () => 'tenant-1' }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformMetricsPage />
    </QueryClientProvider>,
  )
}

const PLATFORM_METRICS_BODY = {
  gmvDiram: 500_000,
  orderCount: 5,
  averageCheckDiram: 100_000,
  pickupSlaComplianceRate: 0.8,
  deliverySlaComplianceRate: 0.7,
  cancellationRate: 0.1,
  activePharmaciesSendingDataRate: 0.375,
}

const ZERO_METRICS_BODY = {
  gmvDiram: 0,
  orderCount: 0,
  averageCheckDiram: 0,
  pickupSlaComplianceRate: 0,
  deliverySlaComplianceRate: 0,
  cancellationRate: 0,
  activePharmaciesSendingDataRate: 0,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PlatformMetricsPage (DTJ-382)', () => {
  it('рендерит 5 карточек метрик', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: PLATFORM_METRICS_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('platform-metrics-card-gmv')).toBeInTheDocument() })
    expect(screen.getByTestId('platform-metrics-card-pickup-sla')).toBeInTheDocument()
    expect(screen.getByTestId('platform-metrics-card-delivery-sla')).toBeInTheDocument()
    expect(screen.getByTestId('platform-metrics-card-cancellation-rate')).toBeInTheDocument()
    expect(screen.getByTestId('platform-metrics-card-active-pharmacies')).toBeInTheDocument()
  })

  it('GMV-карточка показывает и GMV, и средний чек одновременно', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: PLATFORM_METRICS_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('platform-metrics-card-gmv')).toBeInTheDocument() })
    expect(screen.getByTestId('platform-metrics-card-gmv')).toHaveTextContent('5 000') // 500 000 диров = 5 000 сомони
    expect(screen.getByTestId('platform-metrics-card-gmv')).toHaveTextContent('1 000') // средний чек 100 000 диров = 1 000 сомони
  })

  it('activePharmaciesSendingDataRate=0.375 (ниже порога 60%) → Badge danger виден', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: PLATFORM_METRICS_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('platform-metrics-active-pharmacies-badge-danger')).toBeInTheDocument() })
  })

  it('activePharmaciesSendingDataRate выше порога 60% → Badge danger НЕ рендерится', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: { ...PLATFORM_METRICS_BODY, activePharmaciesSendingDataRate: 0.75 } })),
    )
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('platform-metrics-card-active-pharmacies')).toBeInTheDocument() })
    expect(screen.queryByTestId('platform-metrics-active-pharmacies-badge-danger')).not.toBeInTheDocument()
  })

  it('переключение периода на "Неделя" запускает новый запрос с форматом YYYY-Www', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: PLATFORM_METRICS_BODY }))
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

  it('все метрики нулевые (АС3-подобный сценарий) — 0%, без NaN/падения', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: ZERO_METRICS_BODY })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('platform-metrics-card-pickup-sla')).toBeInTheDocument() })
    const pickupCard = screen.getByTestId('platform-metrics-card-pickup-sla').textContent
    expect(pickupCard).not.toMatch(/NaN|Infinity/)
    expect(pickupCard).toMatch(/0\s*%/)
  })
})
