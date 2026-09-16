import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRequestReturn } from './use-request-return'
import type { RequestReturnInput } from './use-request-return'

/**
 * `use-request-return.spec.tsx` (DTJ-276, тест-план: «Интеграционный тест use-request-return.ts —
 * мок API, проверка, что Idempotency-Key переиспользуется при ретрае того же запроса и меняется
 * при новой явной попытке пользователя»). Тот же приём, что `use-create-order.spec.tsx` (DTJ-235).
 */

const INPUT: RequestReturnInput = { orderId: 'order-1', reason: 'defect' }

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

describe('useRequestReturn (DTJ-276)', () => {
  it('первый submit() генерирует UUID v4 и шлёт его заголовком Idempotency-Key', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { kind: 'return_created', orderReturn: { id: 'r1' } } }), { status: 201 }),
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useRequestReturn(), { wrapper: makeWrapper(queryClient) })

    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain('/api/v1/order-returns')
    expect(readIdempotencyKey(fetchMock, 0)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('РЕТРАЙ (второй submit() после провала, БЕЗ invalidateIdempotencyKey) переиспользует ТОТ ЖЕ ключ (АС2)', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(null, { status: 500 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useRequestReturn(), { wrapper: makeWrapper(queryClient) })

    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })

    expect(readIdempotencyKey(fetchMock, 0)).toBe(readIdempotencyKey(fetchMock, 1))
  })

  it('invalidateIdempotencyKey() между попытками → следующий submit() генерирует НОВЫЙ ключ', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(null, { status: 500 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useRequestReturn(), { wrapper: makeWrapper(queryClient) })

    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })

    act(() => { result.current.invalidateIdempotencyKey() })
    act(() => { result.current.submit(INPUT) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })

    expect(readIdempotencyKey(fetchMock, 0)).not.toBe(readIdempotencyKey(fetchMock, 1))
  })

  it('onSuccess переданный в submit() получает распакованный результат мутации', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { kind: 'return_created', orderReturn: { id: 'r1' } } }), { status: 201 }),
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useRequestReturn(), { wrapper: makeWrapper(queryClient) })

    const onSuccess = vi.fn()
    act(() => { result.current.submit(INPUT, { onSuccess }) })

    await waitFor(() => { expect(onSuccess).toHaveBeenCalledWith({ kind: 'return_created', orderReturn: { id: 'r1' } }) })
  })
})
