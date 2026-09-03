import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCreateOrder } from './use-create-order'
import type { CreateOrderInput } from './create-order.api'

/**
 * `use-create-order.spec.ts` (DTJ-235, DoD: «`Idempotency-Key` генерируется один раз на попытку,
 * не на каждый рендер — явно протестировано»).
 *
 * Проверяет ИМЕННО правило генерации/переиспользования/инвалидации ключа, описанное в JSDoc
 * `use-create-order.ts` — сетевая форма запроса уже покрыта `create-order.api.spec.ts`.
 */

const INPUT: CreateOrderInput = {
  cartItemIds: ['item-1'],
  deliveryAddressId: null,
  inlineAddress: { addressText: 'ул. Рудаки, 12', landmarkText: null, latitude: 38.55, longitude: 68.78 },
  deliveryLandmark: null,
  paymentMethod: 'cash_courier',
}

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

function readIdempotencyKey(fetchMock: ReturnType<typeof vi.fn<FetchImpl>>, callIndex: number): string | null {
  const [, init] = fetchMock.mock.calls[callIndex] ?? []
  return new Headers(init?.headers).get('Idempotency-Key')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCreateOrder (DTJ-235)', () => {
  it('1. первый submit() генерирует UUID v4 и шлёт его заголовком Idempotency-Key', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { orders: [], failedGroups: [] } }), { status: 200 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCreateOrder(), { wrapper: makeWrapper(queryClient) })

    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    const key = readIdempotencyKey(fetchMock, 0)
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('2. РЕТРАЙ (второй submit() ПОСЛЕ провала, БЕЗ вызова invalidateIdempotencyKey) переиспользует ТОТ ЖЕ ключ', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(null, { status: 500 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCreateOrder(), { wrapper: makeWrapper(queryClient) })

    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })

    expect(readIdempotencyKey(fetchMock, 0)).toBe(readIdempotencyKey(fetchMock, 1))
  })

  it('3. invalidateIdempotencyKey() между попытками → следующий submit() генерирует НОВЫЙ ключ', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(null, { status: 500 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCreateOrder(), { wrapper: makeWrapper(queryClient) })

    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    act(() => { result.current.invalidateIdempotencyKey() })
    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })

    expect(readIdempotencyKey(fetchMock, 0)).not.toBe(readIdempotencyKey(fetchMock, 1))
  })

  it('4. onSettled переданный в submit() вызывается после ответа (используется для снятия мьютекса формы)', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { orders: [], failedGroups: [] } }), { status: 200 })),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useCreateOrder(), { wrapper: makeWrapper(queryClient) })

    const onSettled = vi.fn()
    act(() => { result.current.submit(INPUT, { onSettled }) })

    await waitFor(() => { expect(onSettled).toHaveBeenCalledTimes(1) })
  })
})
