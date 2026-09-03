import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/config/env'
import { useCartSessionStore } from '../model/cart-session-store'
import type { CartView } from './cart.api'
import { CART_QUERY_KEY } from './use-cart'
import { useCartMutations } from './use-cart-mutations'

/**
 * `use-cart-mutations.spec.tsx` (DTJ-234). Проверяет optimistic update + откат `removeItem`/
 * `updateQuantity` (тикет «Что сделать» §2) и что `addItem` реально бьёт в сеть (см. JSDoc
 * `use-cart-mutations.ts` — не вызывается UI ЭТОГО тикета, подключение проверяется тестом).
 */

const ITEMS_URL = `${getClientEnv().apiBaseUrl}/api/v1/cart/items`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function seedCart(queryClient: QueryClient, cart: CartView): void {
  queryClient.setQueryData(CART_QUERY_KEY, cart)
}

const BASE_CART: CartView = {
  items: [
    {
      id: 'item-1',
      cartId: 'cart-1',
      medicineId: 'm1',
      medicineTradeName: 'Медикамент 1',
      pharmacyId: 'p1',
      pharmacyName: 'Аптека 1',
      quantity: 2,
      priceDiram: 500,
      availableQuantity: 5,
      addedAt: 'x',
    },
  ],
  pharmacyGroups: [{ pharmacyId: 'p1', pharmacyName: 'Аптека 1', items: [], subtotalDiram: 1000 }],
  warnings: [],
}

function makeWrapper(
  queryClient: QueryClient,
): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  window.localStorage.clear()
  useCartSessionStore.setState({ sessionToken: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCartMutations (DTJ-234)', () => {
  it('1. removeItem — оптимистично убирает строку из кэша ДО ответа сервера', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seedCart(queryClient, BASE_CART)
    let resolveResponse: (() => void) | undefined
    stubFetch(
      () =>
        new Promise((resolve) => {
          resolveResponse = () => {
            resolve(new Response(null, { status: 204 }))
          }
        }),
    )

    const { result } = renderHook(() => useCartMutations(), { wrapper: makeWrapper(queryClient) })
    act(() => {
      result.current.removeItem.mutate('item-1')
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<CartView>(CART_QUERY_KEY)?.items).toHaveLength(0)
    })

    resolveResponse?.()
    await waitFor(() => {
      expect(result.current.removeItem.isSuccess).toBe(true)
    })
  })

  it('2. removeItem — на ошибке откатывает кэш к предыдущему состоянию', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seedCart(queryClient, BASE_CART)
    stubFetch(() => Promise.resolve(new Response(null, { status: 500 })))

    const { result } = renderHook(() => useCartMutations(), { wrapper: makeWrapper(queryClient) })
    act(() => {
      result.current.removeItem.mutate('item-1')
    })

    await waitFor(() => {
      expect(result.current.removeItem.isError).toBe(true)
    })
    expect(queryClient.getQueryData<CartView>(CART_QUERY_KEY)?.items).toHaveLength(1)
  })

  it('3. updateQuantity — оптимистично меняет quantity и корректирует subtotalDiram группы (целые дирамы)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seedCart(queryClient, BASE_CART)
    let resolveResponse: (() => void) | undefined
    stubFetch(
      () =>
        new Promise((resolve) => {
          resolveResponse = () => {
            resolve(
              jsonResponse({
                data: {
                  id: 'item-1',
                  cartId: 'cart-1',
                  medicineId: 'm1',
                  pharmacyId: 'p1',
                  quantity: 3,
                  addedAt: 'x',
                },
              }),
            )
          }
        }),
    )

    const { result } = renderHook(() => useCartMutations(), { wrapper: makeWrapper(queryClient) })
    act(() => {
      result.current.updateQuantity.mutate({ cartItemId: 'item-1', quantity: 3 })
    })

    await waitFor(() => {
      const cached = queryClient.getQueryData<CartView>(CART_QUERY_KEY)
      expect(cached?.items[0]?.quantity).toBe(3)
      expect(cached?.pharmacyGroups[0]?.subtotalDiram).toBe(1500)
    })

    resolveResponse?.()
    await waitFor(() => {
      expect(result.current.updateQuantity.isSuccess).toBe(true)
    })
  })

  it('4. addItem — вызывает POST /cart/items (подключён и работоспособен, хоть и без UI-вызова в этом тикете)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            id: 'item-2',
            cartId: 'cart-1',
            medicineId: 'm2',
            pharmacyId: 'p1',
            quantity: 1,
            addedAt: 'x',
          },
          meta: { warnings: [] },
        }),
      ),
    )

    const { result } = renderHook(() => useCartMutations(), { wrapper: makeWrapper(queryClient) })
    act(() => {
      result.current.addItem.mutate({ medicineId: 'm2', pharmacyId: 'p1', quantity: 1 })
    })

    await waitFor(() => {
      expect(result.current.addItem.isSuccess).toBe(true)
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(ITEMS_URL)
    expect(init?.method).toBe('POST')
  })
})
