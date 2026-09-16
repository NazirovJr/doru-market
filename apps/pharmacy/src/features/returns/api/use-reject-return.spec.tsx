import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRejectReturn } from './use-reject-return'

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

describe('useRejectReturn (DTJ-277)', () => {
  it('POST /:id/reject с причиной → успех', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { id: 'ret-1', status: 'return_rejected' } }), { status: 200 }),
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

    const { result } = renderHook(() => useRejectReturn(), { wrapper: makeWrapper(queryClient) })
    result.current.mutate({ returnId: 'ret-1', reason: 'Упаковка вскрыта после отправки' })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/order-returns/ret-1/reject')
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Упаковка вскрыта после отправки' })
  })
})
