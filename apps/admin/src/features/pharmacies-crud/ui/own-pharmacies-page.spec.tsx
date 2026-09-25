import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { InventorySummaryDto, PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { OwnPharmaciesPage } from './own-pharmacies-page'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stubFetch(response: Response): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(response))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// Список и inventory-summary — разные эндпоинты одного мока, роутинг по вхождению пути.
function stubFetchByPath(listResponse: Response, summaryResponse: Response): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>((input) =>
    Promise.resolve(input.includes('/inventory-summary') ? summaryResponse.clone() : listResponse.clone()),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/my-pharmacies']}>
        <OwnPharmaciesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const OWN_ACCOUNT: PharmacyAccountAdminSummaryDto = {
  id: 'pharmacy-1',
  chainId: 'chain-a',
  chainName: 'Own Network',
  name: 'Own Pharmacy #1',
  status: 'active',
  licenseExpiryDate: daysFromNow(400),
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OwnPharmaciesPage (DTJ-362)', () => {
  it('рендерит запрос со scope=own, без фильтра по сети', async () => {
    const fetchMock = stubFetch(jsonResponse({ data: [OWN_ACCOUNT] }))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('own-pharmacy-row')).toHaveLength(1) })
    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.searchParams.get('scope')).toBe('own')
    expect(url.searchParams.has('filter[chainId]')).toBe(false)
    expect(screen.getByText('Own Pharmacy #1')).toBeInTheDocument()
  })

  // licenseExpiryDate < 30 дней — строка помечена предупреждением.
  it('лицензия истекает через 20 дней — показан badge предупреждения', async () => {
    const expiringSoon: PharmacyAccountAdminSummaryDto = { ...OWN_ACCOUNT, id: 'pharmacy-2', licenseExpiryDate: daysFromNow(20) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [expiringSoon] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('own-pharmacy-row')).toHaveLength(1) })
    expect(screen.getByTestId('own-pharmacy-license-warning-badge')).toBeInTheDocument()
  })

  it('лицензия истекает через 400 дней — badge предупреждения отсутствует', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [OWN_ACCOUNT] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('own-pharmacy-row')).toHaveLength(1) })
    expect(screen.queryByTestId('own-pharmacy-license-warning-badge')).not.toBeInTheDocument()
  })

  it('licenseExpiryDate: null — без badge предупреждения, прочерк в колонке', async () => {
    const noLicense: PharmacyAccountAdminSummaryDto = { ...OWN_ACCOUNT, id: 'pharmacy-3', licenseExpiryDate: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [noLicense] })))
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('own-pharmacy-row')).toHaveLength(1) })
    expect(screen.queryByTestId('own-pharmacy-license-warning-badge')).not.toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('пустой список — без падения, показывает "точек пока нет"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    renderPage()

    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument() })
    expect(screen.queryAllByTestId('own-pharmacy-row')).toHaveLength(0)
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })

  it('клик на название точки раскрывает сводку остатков (skuCount, staleDataSharePercent)', async () => {
    const summary: InventorySummaryDto = { skuCount: 12, staleDataSharePercent: 0 }
    stubFetchByPath(jsonResponse({ data: [OWN_ACCOUNT] }), jsonResponse({ data: summary }))
    renderPage()
    await waitFor(() => { expect(screen.getAllByTestId('own-pharmacy-row')).toHaveLength(1) })

    fireEvent.click(screen.getByTestId('own-pharmacy-name-toggle'))

    await waitFor(() => { expect(screen.getByTestId('own-pharmacy-inventory-summary')).toBeInTheDocument() })
    expect(screen.getByTestId('own-pharmacy-inventory-summary').textContent).toContain('12')
    expect(screen.queryByTestId('own-pharmacy-inventory-stale-warning-badge')).not.toBeInTheDocument()
  })

  it('staleDataSharePercent > 0 — показан badge предупреждения об устаревших остатках', async () => {
    const summary: InventorySummaryDto = { skuCount: 5, staleDataSharePercent: 25 }
    stubFetchByPath(jsonResponse({ data: [OWN_ACCOUNT] }), jsonResponse({ data: summary }))
    renderPage()
    await waitFor(() => { expect(screen.getAllByTestId('own-pharmacy-row')).toHaveLength(1) })

    fireEvent.click(screen.getByTestId('own-pharmacy-name-toggle'))

    await waitFor(() => { expect(screen.getByTestId('own-pharmacy-inventory-stale-warning-badge')).toBeInTheDocument() })
  })

  it('повторный клик на название сворачивает сводку обратно', async () => {
    const summary: InventorySummaryDto = { skuCount: 1, staleDataSharePercent: 0 }
    stubFetchByPath(jsonResponse({ data: [OWN_ACCOUNT] }), jsonResponse({ data: summary }))
    renderPage()
    await waitFor(() => { expect(screen.getAllByTestId('own-pharmacy-row')).toHaveLength(1) })

    fireEvent.click(screen.getByTestId('own-pharmacy-name-toggle'))
    await waitFor(() => { expect(screen.getByTestId('own-pharmacy-inventory-summary-row')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('own-pharmacy-name-toggle'))

    expect(screen.queryByTestId('own-pharmacy-inventory-summary-row')).not.toBeInTheDocument()
  })
})
