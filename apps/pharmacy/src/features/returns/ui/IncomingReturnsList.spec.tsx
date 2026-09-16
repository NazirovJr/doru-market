import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OrderReturnDto } from '@dorutj/contracts'
import { IncomingReturnsList } from './IncomingReturnsList'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderList(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <IncomingReturnsList />
    </QueryClientProvider>,
  )
  return queryClient
}

function makeReturn(overrides: Partial<OrderReturnDto>): OrderReturnDto {
  return {
    id: 'ret-1',
    orderId: 'order-1',
    status: 'return_in_transit',
    reason: 'defect',
    disposition: null,
    initiatedBy: 'user-1',
    courierId: null,
    courierReturnFeeDiram: 0,
    packagingIntact: null,
    requestedAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<IncomingReturnsList /> (DTJ-277)', () => {
  it('пустой список — показывает сообщения "нет возвратов" в обеих секциях', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: { items: [] } })))
    renderList()

    await waitFor(() => { expect(screen.getByTestId('incoming-returns-list')).toBeInTheDocument() })
    expect(screen.getByText('Бозгашти дар роҳ нест')).toBeInTheDocument()
    expect(screen.getByText('Бозгашти радшуда нест')).toBeInTheDocument()
  })

  it('несколько карточек — распределены по секциям, действия видны только у "в пути"', async () => {
    const items = [
      makeReturn({ id: 'ret-1', status: 'return_in_transit', reason: 'defect' }),
      makeReturn({ id: 'ret-2', status: 'return_rejected', reason: 'wrong_item' }),
    ]
    stubFetch(() => Promise.resolve(jsonResponse({ data: { items } })))
    renderList()

    await waitFor(() => { expect(screen.getAllByTestId('return-card')).toHaveLength(2) })
    const ctas = screen.getAllByTestId('return-card-confirm-cta')
    expect(ctas).toHaveLength(1)
  })

  it('ошибка загрузки — показывает сообщение об ошибке', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500)))
    renderList()

    await waitFor(() => { expect(screen.getByTestId('incoming-returns-error')).toBeInTheDocument() })
  })

  it('«Принять возврат» открывает чек-лист приёмки этой карточки', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: { items: [makeReturn({})] } })))
    renderList()

    await waitFor(() => { expect(screen.getByTestId('return-card-confirm-cta')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('return-card-confirm-cta'))

    expect(screen.getByTestId('return-checklist-form')).toBeInTheDocument()
  })

  it('«Отклонить» без причины — отправка блокируется, показывается ошибка валидации (критерий приёмки 3)', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: { items: [makeReturn({})] } })))
    renderList()

    await waitFor(() => { expect(screen.getByTestId('return-card-reject-cta')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('return-card-reject-cta'))
    fireEvent.click(screen.getByTestId('reject-submit'))

    expect(screen.getByTestId('reject-reason-required')).toBeInTheDocument()
  })

  it('«Отклонить» с причиной — отправляет запрос и закрывает панель', async () => {
    const fetchMock = stubFetch((url) => {
      if (typeof url === 'string' && url.includes('/reject')) {
        return Promise.resolve(jsonResponse({ data: { id: 'ret-1', status: 'return_rejected' } }))
      }
      return Promise.resolve(jsonResponse({ data: { items: [makeReturn({})] } }))
    })
    renderList()

    await waitFor(() => { expect(screen.getByTestId('return-card-reject-cta')).toBeInTheDocument() })
    fireEvent.click(screen.getByTestId('return-card-reject-cta'))
    fireEvent.change(screen.getByTestId('reject-reason'), { target: { value: 'Заявлено ошибочно' } })
    fireEvent.click(screen.getByTestId('reject-submit'))

    await waitFor(() => { expect(screen.queryByTestId('reject-panel')).not.toBeInTheDocument() })
    const rejectCall = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/reject'))
    expect(rejectCall).toBeDefined()
  })
})
