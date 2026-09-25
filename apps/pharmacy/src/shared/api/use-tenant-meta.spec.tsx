import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTenantMeta } from './use-tenant-meta'

type FetchImpl = (input: string) => Promise<Response>

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

describe('useTenantMeta (DTJ-033, GET /tenant/meta)', () => {
  it('запрашивает /api/v1/tenant/meta и возвращает пороги как есть', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { inventoryDeltaSlaMinutes: 15, inventoryManualStaleHours: 72 } }), { status: 200 }),
      ),
    )

    const { result } = renderHook(() => useTenantMeta(), { wrapper })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data).toEqual({ inventoryDeltaSlaMinutes: 15, inventoryManualStaleHours: 72 })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/v1/tenant/meta')
  })

  it('enabled=false — сеть не вызывается', () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 })))
    renderHook(() => useTenantMeta(false), { wrapper })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
