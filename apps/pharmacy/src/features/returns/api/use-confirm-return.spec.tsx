import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useConfirmReturn } from './use-confirm-return'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

/** DTJ-277 критерий приёмки 1: сервер возвращает вычисленный disposition, клиент его НЕ пересчитывает. */
describe('useConfirmReturn (DTJ-277)', () => {
  it('POST /:id/confirm с чек-листом → возвращает disposition РОВНО как ответил сервер', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: { id: 'ret-1', orderId: 'order-1', status: 'return_confirmed', disposition: 'restock' } }),
          { status: 200 },
        ),
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

    const { result } = renderHook(() => useConfirmReturn(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate({ returnId: 'ret-1', checklist: { packagingIntact: true } })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data?.disposition).toBe('restock')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/order-returns/ret-1/confirm')
    expect(JSON.parse(init.body as string)).toEqual({ checklist: { packagingIntact: true } })
  })

  it('ошибка сервера → isError=true, disposition НЕ подставляется клиентом', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'RETURN_NOT_FOUND' } }), { status: 404 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

    const { result } = renderHook(() => useConfirmReturn(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate({ returnId: 'ret-1', checklist: { packagingIntact: true } })

    await waitFor(() => { expect(result.current.isError).toBe(true) })
    expect(result.current.data).toBeUndefined()
  })
})
