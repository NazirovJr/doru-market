import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PharmacyTerminalQueueItemDto } from '@dorutj/contracts'
import { ORDER_QUEUE_QUERY_KEY, useAcceptOrder, useOrderQueue } from './orders-queue.api'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function makeWrapper(queryClient: QueryClient): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeItem(overrides: Partial<PharmacyTerminalQueueItemDto>): PharmacyTerminalQueueItemDto {
  return {
    id: 'order-1',
    orderNumber: 'DTJ-260925-00001',
    status: 'paid_escrow',
    itemsCount: 1,
    itemsTotalTjs: 100,
    paymentMethod: 'alif_mobi',
    prescriptionRequired: false,
    slaDeadlineAt: null,
    assignedPharmacistId: null,
    assignedPharmacistName: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useOrderQueue', () => {
  it('запрашивает очередь БЕЗ filter[pharmacyId] (скоуп — из JWT) с sort=priority', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useOrderQueue(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('pharmacyId')
    expect(url).toContain('sort=priority')
  })
})

describe('useAcceptOrder', () => {
  it('шлёт Idempotency-Key заголовком, ключ на КАЖДЫЙ вызов новый (генерация в момент клика)', async () => {
    const fetchMock = stubFetch((url) => {
      if (typeof url === 'string' && url.includes('/accept')) {
        return Promise.resolve(jsonResponse({ data: { id: 'order-1', status: 'processing', slaDeadlineAt: '2026-09-25T10:07:00.000Z', assignedPharmacistId: 'me' } }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const { result } = renderHook(() => useAcceptOrder('me'), { wrapper: makeWrapper(queryClient) })

    result.current.mutate({ orderId: 'order-1', idempotencyKey: 'key-1' })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const acceptCall = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/accept'))
    expect(acceptCall).toBeDefined()
    const [, init] = acceptCall as [string, RequestInit]
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-1')
  })

  it('оптимистично переводит карточку в processing ДО ответа сервера', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    queryClient.setQueryData(ORDER_QUEUE_QUERY_KEY, [makeItem({ id: 'order-1', status: 'paid_escrow' })])
    let resolveAccept: (() => void) | undefined
    stubFetch((url) => {
      if (typeof url === 'string' && url.includes('/accept')) {
        return new Promise((resolve) => {
          resolveAccept = () => { resolve(jsonResponse({ data: { id: 'order-1', status: 'processing', slaDeadlineAt: null, assignedPharmacistId: 'me' } })) }
        })
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const { result } = renderHook(() => useAcceptOrder('me'), { wrapper: makeWrapper(queryClient) })
    result.current.mutate({ orderId: 'order-1', idempotencyKey: 'key-1' })

    await waitFor(() => {
      const cached = queryClient.getQueryData<readonly PharmacyTerminalQueueItemDto[]>(ORDER_QUEUE_QUERY_KEY)
      expect(cached?.[0]?.status).toBe('processing')
    })
    resolveAccept?.()
  })

  it('409 ORDER_ALREADY_CLAIMED — откатывает оптимизм на РЕАЛЬНОГО владельца из details (негативный сценарий)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    queryClient.setQueryData(ORDER_QUEUE_QUERY_KEY, [makeItem({ id: 'order-1', status: 'paid_escrow' })])
    stubFetch((url) => {
      if (typeof url === 'string' && url.includes('/accept')) {
        return Promise.resolve(
          jsonResponse(
            { error: { code: 'ORDER_ALREADY_CLAIMED', details: { assignedPharmacistId: 'colleague-1', assignedPharmacistName: 'Фарзона М.' } } },
            409,
          ),
        )
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const { result } = renderHook(() => useAcceptOrder('me'), { wrapper: makeWrapper(queryClient) })
    result.current.mutate({ orderId: 'order-1', idempotencyKey: 'key-1' })

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    const cached = queryClient.getQueryData<readonly PharmacyTerminalQueueItemDto[]>(ORDER_QUEUE_QUERY_KEY)
    expect(cached?.[0]?.assignedPharmacistId).toBe('colleague-1')
    expect(cached?.[0]?.assignedPharmacistName).toBe('Фарзона М.')
  })
})
