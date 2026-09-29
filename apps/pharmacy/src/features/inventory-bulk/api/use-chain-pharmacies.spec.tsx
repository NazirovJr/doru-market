import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChainPharmacies } from './use-chain-pharmacies'

type FetchImpl = (input: string) => Promise<Response>

function stubFetch(impl: FetchImpl): void {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function makeWrapper(queryClient: QueryClient): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useChainPharmacies (DTJ-441)', () => {
  it('сетевой pharmacy_admin — возвращает список аптек сети', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ id: 'ph-1', chainId: 'chain-1', chainName: 'Excel', name: 'Excel Center', status: 'active', licenseExpiryDate: null }] }),
          { status: 200 },
        ),
      ),
    )
    const { result } = renderHook(() => useChainPharmacies(true), { wrapper: makeWrapper(makeQueryClient()) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data).toHaveLength(1)
  })

  it('аптека-привязанный pharmacy_admin — 403 CROSS_TENANT_ACCESS_DENIED трактуется как пустой список, без ошибки', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'CROSS_TENANT_ACCESS_DENIED', message: 'x' } }), { status: 403 })),
    )
    const { result } = renderHook(() => useChainPharmacies(true), { wrapper: makeWrapper(makeQueryClient()) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data).toEqual([])
  })

  it('enabled=false — запрос не выполняется', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useChainPharmacies(false), { wrapper: makeWrapper(makeQueryClient()) })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
