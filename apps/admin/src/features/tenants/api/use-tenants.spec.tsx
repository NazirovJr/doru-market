import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TenantDetailDto } from '@dorutj/contracts'
import { getClientEnv } from '@/shared/api/http-client'
import { tenantQueryKey, tenantsListQueryKey, useTenant, useTenantsList, useUpdateTenantSettings } from './use-tenants'

const API_BASE = getClientEnv().apiBaseUrl

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function makeWrapper(queryClient: QueryClient): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const DETAIL: TenantDetailDto = {
  id: 'tenant-1',
  slug: 'apteka-vasco',
  isNeutral: false,
  customDomain: null,
  brandName: 'Vasco',
  brandLogoUrl: null,
  brandPalette: {},
  codLimitDiram: 50_000,
  holdPeriodDays: 1,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTenantsList', () => {
  it('GET /api/v1/tenants?limit=100', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [DETAIL] })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useTenantsList(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE}/api/v1/tenants?limit=100`)
    expect(result.current.data).toEqual([DETAIL])
  })
})

describe('useTenant', () => {
  it('GET /api/v1/tenants/:id', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: DETAIL })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useTenant('tenant-1'), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API_BASE}/api/v1/tenants/tenant-1`)
  })
})

describe('useUpdateTenantSettings', () => {
  it('PATCH /api/v1/tenant-settings/:id с телом патча, затем инвалидирует список и кэширует деталь', async () => {
    const updated = { ...DETAIL, brandName: 'Renamed' }
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: updated })))
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateTenantSettings(), { wrapper: makeWrapper(queryClient) })

    result.current.mutate({ tenantId: 'tenant-1', patch: { brandName: 'Renamed' } })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${API_BASE}/api/v1/tenant-settings/tenant-1`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string) as unknown).toEqual({ brandName: 'Renamed' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: tenantsListQueryKey() })
    expect(queryClient.getQueryData(tenantQueryKey('tenant-1'))).toEqual(updated)
  })
})
