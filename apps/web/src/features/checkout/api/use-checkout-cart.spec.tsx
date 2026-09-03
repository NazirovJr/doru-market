import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/config/env'
import { useCheckoutCart } from './use-checkout-cart'

/**
 * `use-checkout-cart.spec.tsx` (DTJ-235) — тот же приём, что `features/cart/api/use-cart.spec.tsx`.
 */

const CART_URL = `${getClientEnv().apiBaseUrl}/api/v1/cart`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCheckoutCart (DTJ-235)', () => {
  it('1. enabled=true — запрашивает GET /api/v1/cart', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { items: [] }, meta: { pharmacyGroups: [] } }), { status: 200 })),
    )
    const { result } = renderHook(() => useCheckoutCart(true), { wrapper })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(CART_URL)
  })

  it('2. enabled=false (гость, не аутентифицирован) — запрос НЕ уходит (см. JSDoc checkout-cart.api.ts)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { items: [] }, meta: { pharmacyGroups: [] } }), { status: 200 })),
    )
    renderHook(() => useCheckoutCart(false), { wrapper })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
