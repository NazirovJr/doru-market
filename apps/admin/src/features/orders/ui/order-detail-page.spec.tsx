import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { OrderDetailAdminDto } from '@dorutj/contracts'
import { OrderDetailPage } from './order-detail-page'

const { getCurrentRoleMock } = vi.hoisted(() => ({ getCurrentRoleMock: vi.fn() }))
vi.mock('@/shared/auth/current-role', () => ({ getCurrentRole: getCurrentRoleMock }))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage(orderId = 'order-1'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/orders/${orderId}`]}>
        <Routes>
          <Route path="/admin/orders/:id" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const BASE_DETAIL: OrderDetailAdminDto = {
  id: 'order-1',
  orderNumber: 'DTJ-260927-00001',
  status: 'processing',
  tenantId: 'tenant-1',
  pharmacyId: 'pharmacy-1',
  customerId: 'customer-1',
  paymentMethod: 'alif_mobi',
  totalAmountDiram: 12_345,
  prescriptionId: null,
  createdAt: '2026-09-27T10:00:00.000Z',
  timeline: {
    createdAt: '2026-09-27T10:00:00.000Z',
    processingStartedAt: '2026-09-27T10:05:00.000Z',
    pickedUpAt: null,
    deliveredAt: null,
    slaDeadlineAt: null,
    cancelReason: null,
    updatedAt: '2026-09-27T10:05:00.000Z',
  },
  escrowLedger: [],
  payoutSchedule: null,
  prescriptionMeta: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
  getCurrentRoleMock.mockReset()
})

describe('OrderDetailPage (DTJ-355/363)', () => {
  it('АС1 — cash_courier: escrowLedger=null показывает явное сообщение "не применяется", не пустую таблицу', async () => {
    getCurrentRoleMock.mockReturnValue('super_admin')
    const detail: OrderDetailAdminDto = { ...BASE_DETAIL, paymentMethod: 'cash_courier', escrowLedger: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: detail })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-detail-escrow-not-applicable')).toBeInTheDocument() })
    expect(screen.getByText('Эскроу не применяется — оплата наличными')).toBeInTheDocument()
    expect(screen.queryByTestId('order-detail-escrow-row')).not.toBeInTheDocument()
  })

  it('DoD DTJ-363 — super_admin видит секцию действий (заготовка DTJ-356)', async () => {
    getCurrentRoleMock.mockReturnValue('super_admin')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: BASE_DETAIL })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-detail-actions-placeholder')).toBeInTheDocument() })
  })

  it('DoD DTJ-363 — pharmacy_admin: секция действий НЕ смонтирована (не CSS-скрытие)', async () => {
    getCurrentRoleMock.mockReturnValue('pharmacy_admin')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: BASE_DETAIL })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-detail-summary')).toBeInTheDocument() })
    expect(screen.queryByTestId('order-detail-actions-placeholder')).not.toBeInTheDocument()
  })

  it('prescriptionMeta=null — показывает "рецепт не прикреплён", без кнопки показа изображения', async () => {
    getCurrentRoleMock.mockReturnValue('super_admin')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: BASE_DETAIL })))
    renderPage()

    await waitFor(() => { expect(screen.getByText('Рецепт не прикреплён')).toBeInTheDocument() })
    expect(screen.queryByTestId('order-detail-prescription-show-image')).not.toBeInTheDocument()
  })

  it('prescriptionMeta присутствует — кнопка "Показать изображение" физически неактивна (TODO DTJ-376)', async () => {
    getCurrentRoleMock.mockReturnValue('super_admin')
    const detail: OrderDetailAdminDto = { ...BASE_DETAIL, prescriptionId: 'rx-1', prescriptionMeta: { prescriptionId: 'rx-1', status: 'verified' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: detail })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-detail-prescription-show-image')).toBeDisabled() })
  })

  it('ошибка загрузки (напр. 403 у pharmacy_admin чужой сети) — показывает alert', async () => {
    getCurrentRoleMock.mockReturnValue('pharmacy_admin')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'CROSS_TENANT_ACCESS_DENIED' } }, 403)))
    renderPage()

    await waitFor(() => { expect(screen.getByRole('alert')).toBeInTheDocument() })
  })
})
