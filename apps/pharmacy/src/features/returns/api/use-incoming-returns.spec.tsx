import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OrderReturnDto } from '@dorutj/contracts'
import { useIncomingReturns } from './use-incoming-returns'

/**
 * DTJ-277 критерий приёмки 4: запрос списка идёт СО скоупом текущей аптеки — `pharmacyId`
 * берётся из сессии (JWT в `Authorization`, `http-client.ts`), НЕ из URL. UI-тест здесь
 * ограничивается проверкой, что исходящий URL не содержит `pharmacyId`.
 */

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function makeWrapper(queryClient: QueryClient): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
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

describe('useIncomingReturns (DTJ-277)', () => {
  it('запрашивает список БЕЗ pharmacyId в URL (скоуп — из JWT, критерий приёмки 4)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { items: [] } }), { status: 200 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useIncomingReturns(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('pharmacyId')
    expect(url).toContain('filter[status][in]=return_in_transit,return_rejected')
  })

  it('группирует ответ сервера по статусу: return_in_transit / return_rejected', async () => {
    const items = [
      makeReturn({ id: 'ret-1', status: 'return_in_transit' }),
      makeReturn({ id: 'ret-2', status: 'return_rejected' }),
      makeReturn({ id: 'ret-3', status: 'return_in_transit' }),
    ]
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: { items } }), { status: 200 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useIncomingReturns(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data?.inTransit.map((item) => item.id)).toEqual(['ret-1', 'ret-3'])
    expect(result.current.data?.rejected.map((item) => item.id)).toEqual(['ret-2'])
  })
})
