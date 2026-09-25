import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { getClientEnv } from '@/shared/api/http-client'
import { usePharmacyAccounts, usePharmacyAccountsFilters } from './use-pharmacy-accounts'

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

function makeWrapper(initialEntries: readonly string[] = ['/']): ({ children }: { readonly children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[...initialEntries]}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
}

const ACCOUNT: PharmacyAccountAdminSummaryDto = {
  id: 'pharmacy-1',
  chainId: 'chain-1',
  chainName: 'Salom Network',
  name: 'Salom Pharmacy #1',
  status: 'active',
  licenseExpiryDate: '2027-01-01',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePharmacyAccounts', () => {
  it('GET /api/v1/pharmacy-accounts с bracket-фильтрами, читает pagination из meta', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: [ACCOUNT], meta: { pagination: { nextCursor: 'cur-1', hasMore: true, limit: 50 } } })),
    )
    const filters = { status: 'active', chainId: 'chain-1', name: 'Салом' }

    const { result } = renderHook(() => usePharmacyAccounts(filters, null), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe(`${API_BASE}/api/v1/pharmacy-accounts`)
    expect(url.searchParams.get('filter[status]')).toBe('active')
    expect(url.searchParams.get('filter[chainId]')).toBe('chain-1')
    expect(url.searchParams.get('filter[name][like]')).toBe('Салом')
    expect(result.current.data).toEqual({ items: [ACCOUNT], nextCursor: 'cur-1', hasMore: true })
  })

  it('фильтры не заданы — bracket-параметры отсутствуют в query string', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    const emptyFilters = { status: undefined, chainId: undefined, name: undefined }

    const { result } = renderHook(() => usePharmacyAccounts(emptyFilters, null), { wrapper: makeWrapper() })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.searchParams.has('filter[status]')).toBe(false)
    expect(url.searchParams.has('filter[chainId]')).toBe(false)
    expect(url.searchParams.has('filter[name][like]')).toBe(false)
  })
})

describe('usePharmacyAccountsFilters', () => {
  it('читает фильтры из URL, setFilter добавляет/убирает query-параметр', () => {
    const { result } = renderHook(() => usePharmacyAccountsFilters(), {
      wrapper: makeWrapper(['/admin/pharmacies?status=active']),
    })

    expect(result.current.filters.status).toBe('active')

    act(() => { result.current.setFilter('chainId', 'chain-9') })

    expect(result.current.filters.chainId).toBe('chain-9')
  })

  it('resetFilters очищает все ключи фильтра', () => {
    const { result } = renderHook(() => usePharmacyAccountsFilters(), {
      wrapper: makeWrapper(['/admin/pharmacies?status=active&chainId=chain-1']),
    })

    act(() => { result.current.resetFilters() })

    expect(result.current.filters.status).toBeUndefined()
    expect(result.current.filters.chainId).toBeUndefined()
  })
})
