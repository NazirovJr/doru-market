import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { OrderAdminSummaryDto } from '@dorutj/contracts'
import { OwnOrdersPage } from './own-orders-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/my-orders']}>
        <OwnOrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const BREACHED_ORDER: OrderAdminSummaryDto = {
  id: 'order-1',
  orderNumber: 'DTJ-260927-00001',
  status: 'processing',
  tenantId: 'tenant-1',
  pharmacyId: 'pharmacy-1',
  customerId: 'customer-1',
  paymentMethod: 'alif_mobi',
  totalAmountDiram: 12_345,
  slaBreached: true,
  createdAt: '2026-09-27T10:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OwnOrdersPage (DTJ-363)', () => {
  it('АС2 — slaBreached=true рендерит Badge просрочки SLA', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [BREACHED_ORDER], meta: { pagination: { nextCursor: null, hasMore: false } } })),
    )
    renderPage()

    await waitFor(() => { expect(screen.getByText('Просрочен SLA')).toBeInTheDocument() })
  })

  it('заказ ведёт на общую READ-ONLY карточку /admin/orders/:id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [BREACHED_ORDER], meta: { pagination: { nextCursor: null, hasMore: false } } })),
    )
    renderPage()

    await waitFor(() => { expect(screen.getByText('DTJ-260927-00001')).toBeInTheDocument() })
    const link = screen.getByText('DTJ-260927-00001').closest('a')
    expect(link).toHaveAttribute('href', '/admin/orders/order-1')
  })

  it('запрос списка идёт с scope=own', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [], meta: { pagination: { nextCursor: null, hasMore: false } } }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await waitFor(() => { expect(fetchMock).toHaveBeenCalled() })
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toContain('scope=own')
  })
})
