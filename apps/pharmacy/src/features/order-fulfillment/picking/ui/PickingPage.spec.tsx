import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { OrderItemDto } from '@dorutj/contracts'
import { useAuthStore } from '@/shared/api/auth-store'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { PickingPage } from './PickingPage'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function makeItem(overrides: Partial<OrderItemDto> & { readonly medicineName: string }): OrderItemDto & { readonly medicineName: string } {
  return {
    id: 'item-1',
    orderId: 'order-1',
    medicineId: 'med-1',
    unitPriceDiram: 1000,
    quantity: 1,
    totalPriceDiram: 1000,
    commissionBps: 500,
    platformFeeDiram: 50,
    fulfillmentStatus: 'pending',
    scannedBatchId: null,
    scannedAt: null,
    scannedBy: null,
    scanMethod: null,
    itemIssueReason: null,
    ...overrides,
  }
}

function makeOrder(overrides: Partial<Record<string, unknown>> & { readonly items: readonly unknown[] }): Record<string, unknown> {
  return {
    id: 'order-1',
    orderNumber: 'DTJ-260925-00001',
    tenantId: 'tenant-1',
    customerId: 'customer-1',
    pharmacyId: 'pharmacy-1',
    status: 'processing',
    paymentMethod: 'alif_mobi',
    billingStrategy: 'single_invoice',
    itemsTotalDiram: 1000,
    deliveryFeeDiram: 0,
    totalAmountDiram: 1000,
    deliveryAddress: 'ул. Рудаки 1',
    deliveryLandmark: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    courierId: null,
    courierEtaMinutes: null,
    cancelReason: null,
    slaDeadlineAt: null,
    processingStartedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    updatedAt: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/orders/order-1']}>
          <Routes>
            <Route path="/orders/:id" element={<PickingPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  )
  return queryClient
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: 'refresh',
    user: { id: 'me', role: 'pharmacist', tenantId: 'tenant-1', phoneNumber: null, fullName: null },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('<PickingPage /> (DTJ-311)', () => {
  it('happy-path скан — позиция переходит в scanned_ok, поле очищается, фокус переходит дальше', async () => {
    const items = [
      makeItem({ id: 'a', medicineName: 'Парацетамол 500мг', fulfillmentStatus: 'pending' }),
      makeItem({ id: 'b', medicineName: 'Ибупрофен 200мг', fulfillmentStatus: 'pending' }),
    ]
    stubFetch((url, init) => {
      if (url.includes('/items/a/scan')) {
        return Promise.resolve(jsonResponse({ data: { ...items[0], fulfillmentStatus: 'scanned_ok', scannedAt: '2026-09-25T10:01:00.000Z' } }))
      }
      void init
      return Promise.resolve(jsonResponse({ data: makeOrder({ items }) }))
    })
    renderPage()

    await waitFor(() => { expect(screen.getAllByTestId('picking-item-row')).toHaveLength(2) })
    fireEvent.click(screen.getAllByTestId('picking-item-select')[0]!)
    const input = await screen.findByTestId('barcode-scan-input')
    fireEvent.change(input, { target: { value: '4601964000125' } })
    fireEvent.click(screen.getByTestId('barcode-scan-submit'))

    // Локаль экрана захардкожена — фокус переходит на позицию «b», её форма открывается заново.
    await waitFor(() => { expect(screen.getAllByTestId('picking-item-badge')[0]?.textContent).toContain('Санҷида шуд') })
    expect(screen.getByTestId('barcode-scan-input')).toBeInTheDocument()
  })

  it('404 ORDER_ITEM_NOT_FOUND — inline-ошибка с именем препарата, позиция остаётся pending, поле не очищается', async () => {
    const items = [makeItem({ id: 'a', medicineName: 'Парацетамол 500мг' })]
    stubFetch((url) => {
      if (url.includes('/scan')) {
        return Promise.resolve(jsonResponse({ error: { code: 'ORDER_ITEM_NOT_FOUND', details: { resolvedName: 'Ибупрофен' } } }, 404))
      }
      return Promise.resolve(jsonResponse({ data: makeOrder({ items }) }))
    })
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('picking-item-row')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('picking-item-select'))
    const input = await screen.findByTestId('barcode-scan-input')
    fireEvent.change(input, { target: { value: '0000000000000' } })
    fireEvent.click(screen.getByTestId('barcode-scan-submit'))

    await waitFor(() => { expect(screen.getByTestId('barcode-scan-error')).toHaveTextContent('Ибупрофен') })
    expect(screen.getByTestId('barcode-scan-input')).toHaveValue('0000000000000')
  })

  it('422 EXPIRED_STOCK — позиция НЕ переходит в scanned_ok, кнопка «Товар недоступен» остаётся доступной', async () => {
    const items = [makeItem({ id: 'a', medicineName: 'Парацетамол 500мг' })]
    stubFetch((url) => {
      if (url.includes('/scan')) {
        return Promise.resolve(jsonResponse({ error: { code: 'EXPIRED_STOCK' } }, 422))
      }
      return Promise.resolve(jsonResponse({ data: makeOrder({ items }) }))
    })
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('picking-item-row')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('picking-item-select'))
    fireEvent.change(await screen.findByTestId('barcode-scan-input'), { target: { value: '123' } })
    fireEvent.click(screen.getByTestId('barcode-scan-submit'))

    await waitFor(() => { expect(screen.getByTestId('barcode-scan-error')).toBeInTheDocument() })
    expect(screen.getByTestId('picking-item-report-issue')).toBeEnabled()
  })

  it('409 ITEM_ALREADY_SCANNED — сообщение «Уже отсканировано», позиция синхронизируется с фактическим состоянием сервера', async () => {
    const items = [makeItem({ id: 'a', medicineName: 'Парацетамол 500мг' })]
    let alreadyScanned = false
    stubFetch((url) => {
      if (url.includes('/scan')) {
        alreadyScanned = true
        return Promise.resolve(jsonResponse({ error: { code: 'ITEM_ALREADY_SCANNED' } }, 409))
      }
      return Promise.resolve(
        jsonResponse({ data: makeOrder({ items: [{ ...items[0], fulfillmentStatus: alreadyScanned ? 'scanned_ok' : 'pending' }] }) }),
      )
    })
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('picking-item-row')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('picking-item-select'))
    fireEvent.change(await screen.findByTestId('barcode-scan-input'), { target: { value: '123' } })
    fireEvent.click(screen.getByTestId('barcode-scan-submit'))

    await waitFor(() => { expect(screen.getByTestId('barcode-scan-error')).toHaveTextContent('Аллакай сканер шудааст') })
    // Рефетч после 409 подтягивает реальное состояние сервера — позиция красится в scanned_ok.
    await waitFor(() => { expect(screen.getByTestId('picking-item-badge')).toHaveTextContent('Санҷида шуд') })
  })

  it('заказ отменён (order.cancelled) — блокирующий диалог, действия недоступны (SRS-PHT-068, негативный сценарий)', async () => {
    const items = [makeItem({ id: 'a', medicineName: 'Парацетамол 500мг' })]
    stubFetch(() => Promise.resolve(jsonResponse({ data: makeOrder({ items, status: 'cancelled' }) })))
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('order-cancelled-dialog')).toBeInTheDocument() })
    expect(screen.getByTestId('picking-item-select')).toBeDisabled()
  })

  it('report-issue — выбор причины и успех красит позицию в unavailable с причиной', async () => {
    const items = [makeItem({ id: 'a', medicineName: 'Парацетамол 500мг' })]
    stubFetch((url) => {
      if (url.includes('/report-issue')) {
        return Promise.resolve(jsonResponse({ data: { ...items[0], fulfillmentStatus: 'unavailable', itemIssueReason: 'out_of_stock' } }))
      }
      return Promise.resolve(jsonResponse({ data: makeOrder({ items }) }))
    })
    renderPage()

    await waitFor(() => { expect(screen.getByTestId('picking-item-report-issue')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('picking-item-report-issue'))
    fireEvent.click(await screen.findByTestId('report-issue-reason-out_of_stock'))
    fireEvent.click(screen.getByTestId('report-issue-submit'))

    await waitFor(() => { expect(screen.queryByTestId('report-issue-modal')).not.toBeInTheDocument() })
    expect(screen.getByTestId('picking-item-badge')).toHaveTextContent('Дар мавҷудӣ нест')
  })
})
