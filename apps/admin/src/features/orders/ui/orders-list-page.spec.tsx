import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { OrderAdminSummaryDto } from '@dorutj/contracts'
import { OrdersListPage } from './orders-list-page'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/orders']}>
        <OrdersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ORDER: OrderAdminSummaryDto = {
  id: 'order-1',
  orderNumber: 'DTJ-260927-00001',
  status: 'processing',
  tenantId: 'tenant-1',
  pharmacyId: 'pharmacy-1',
  customerId: 'customer-1',
  paymentMethod: 'alif_mobi',
  totalAmountDiram: 12_345,
  slaBreached: false,
  createdAt: '2026-09-27T10:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OrdersListPage (DTJ-355)', () => {
  it('рендерит строку заказа с номером-ссылкой на карточку', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [ORDER], meta: { pagination: { nextCursor: null, hasMore: false } } })))
    renderPage()

    await waitFor(() => { expect(screen.getByText('DTJ-260927-00001')).toBeInTheDocument() })
    const link = screen.getByText('DTJ-260927-00001').closest('a')
    expect(link).toHaveAttribute('href', '/admin/orders/order-1')
  })

  it('АС3 — data: [] (номер не найден) — показывает "не найдено", не падает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [], meta: { pagination: { nextCursor: null, hasMore: false } } })))
    renderPage()

    await waitFor(() => { expect(screen.getByText('Заказы не найдены')).toBeInTheDocument() })
  })

  it('ошибка загрузки — показывает alert', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
