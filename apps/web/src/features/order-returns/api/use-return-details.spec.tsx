import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReturnStatus } from '@dorutj/contracts'
import { resolveReturnDetailsRefetchInterval, useReturnDetails } from './use-return-details'

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

/**
 * `resolveReturnDetailsRefetchInterval` — решение о поллинге, покрыто ПРЯМО, без таймеров (см.
 * JSDoc `use-return-details.ts`).
 */
describe('resolveReturnDetailsRefetchInterval (DTJ-276)', () => {
  const nonTerminalStatuses: readonly ReturnStatus[] = [
    'return_requested',
    'return_in_transit',
    'returned_to_pharmacy',
    'return_rejected',
  ]

  it.each(nonTerminalStatuses)('%s — НЕ терминален, поллинг продолжается (АС4: return_rejected — не исключение, SRS-DOM-056)', (status) => {
    expect(resolveReturnDetailsRefetchInterval(status)).toBe(10_000)
  })

  it('return_confirmed — терминален, поллинг останавливается', () => {
    expect(resolveReturnDetailsRefetchInterval('return_confirmed')).toBe(false)
  })

  it('undefined (данных ещё нет) — поллинг продолжается, как для нетерминального статуса', () => {
    expect(resolveReturnDetailsRefetchInterval(undefined)).toBe(10_000)
  })
})

describe('useReturnDetails (DTJ-276)', () => {
  it('загружает возврат по GET /api/v1/order-returns/:id', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: 'r1', status: 'return_requested' } }), { status: 200 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useReturnDetails('r1'), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.data).toEqual({ id: 'r1', status: 'return_requested' }) })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain('/api/v1/order-returns/r1')
  })
})
