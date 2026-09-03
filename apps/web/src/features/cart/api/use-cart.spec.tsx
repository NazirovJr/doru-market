import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/config/env'
import { useCartSessionStore } from '../model/cart-session-store'
import { useCart } from './use-cart'

/**
 * `use-cart.spec.tsx` (DTJ-234). Тот же приём, что `use-pharmacy-map-pins.spec.tsx`.
 */

const CART_URL = `${getClientEnv().apiBaseUrl}/api/v1/cart`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  window.localStorage.clear()
  useCartSessionStore.setState({ sessionToken: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCart (DTJ-234)', () => {
  it('1. extendHold: true — GET /api/v1/cart?extendHold=true (SRS-ORD-005 — при открытии экрана)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } })),
    )
    const { result } = renderHook(() => useCart({ extendHold: true }), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${CART_URL}?extendHold=true`)
  })

  it('2. по умолчанию (без опций) — extendHold не передаётся', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } })),
    )
    const { result } = renderHook(() => useCart(), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(CART_URL)
  })

  it('3. успешный ответ разворачивается в items/pharmacyGroups/warnings', async () => {
    const pharmacyGroups = [{ pharmacyId: 'p1', pharmacyName: 'Аптека 1', items: [], subtotalDiram: 500 }]
    stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            items: [
              {
                id: 'i1',
                cartId: 'c1',
                medicineId: 'm1',
                pharmacyId: 'p1',
                pharmacyName: 'Аптека 1',
                quantity: 1,
                priceDiram: 500,
                availableQuantity: 5,
                addedAt: 'x',
              },
            ],
          },
          meta: { pharmacyGroups, warnings: [] },
        }),
      ),
    )
    const { result } = renderHook(() => useCart({ extendHold: true }), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.data?.pharmacyGroups).toEqual(pharmacyGroups)
  })
})
