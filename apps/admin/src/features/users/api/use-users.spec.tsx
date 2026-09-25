import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { UserSummaryDto } from '@dorutj/contracts'
import { getClientEnv } from '@/shared/api/http-client'
import { useUsers, useUsersFilters, useDeactivateUser, useChangeStaffRole, useGrantPlatformRole } from './use-users'

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

const USER: UserSummaryDto = {
  id: 'user-1',
  tenantId: 'tenant-1',
  phoneNumber: '+992900000001',
  role: 'pharmacist',
  fullName: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useUsers', () => {
  it('GET /api/v1/users с limit + непустыми фильтрами, читает pagination из meta', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: [USER], meta: { pagination: { nextCursor: 'cur-1', hasMore: true, limit: 50 } } })),
    )
    const filters = { role: 'pharmacist' as const, phoneNumber: undefined, tenantId: undefined }

    const { result } = renderHook(() => useUsers(filters, null), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe(`${API_BASE}/api/v1/users`)
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('role')).toBe('pharmacist')
    expect(url.searchParams.has('cursor')).toBe(false)
    expect(result.current.data).toEqual({ items: [USER], nextCursor: 'cur-1', hasMore: true })
  })

  it('cursor передан — попадает в query string', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    const emptyFilters = { role: undefined, phoneNumber: undefined, tenantId: undefined }

    const { result } = renderHook(() => useUsers(emptyFilters, 'cur-2'), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.searchParams.get('cursor')).toBe('cur-2')
  })
})

describe('useUsersFilters', () => {
  it('читает фильтры из URL, setFilter добавляет/убирает query-параметр', () => {
    const { result } = renderHook(() => useUsersFilters(), { wrapper: makeWrapper(['/admin/users?role=pharmacist']) })

    expect(result.current.filters.role).toBe('pharmacist')

    act(() => { result.current.setFilter('phoneNumber', '900000001') })

    expect(result.current.filters.phoneNumber).toBe('900000001')
  })

  it('resetFilters очищает все ключи фильтра', () => {
    const { result } = renderHook(() => useUsersFilters(), {
      wrapper: makeWrapper(['/admin/users?role=pharmacist&tenantId=tenant-1']),
    })

    act(() => { result.current.resetFilters() })

    expect(result.current.filters.role).toBeUndefined()
    expect(result.current.filters.tenantId).toBeUndefined()
  })
})

describe('мутации users', () => {
  it('useDeactivateUser — PATCH /users/:id с { isActive: false }', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: { ...USER, isActive: false } })))

    const { result } = renderHook(() => useDeactivateUser(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync('user-1') })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${API_BASE}/api/v1/users/user-1`)
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({ isActive: false })
  })

  it('useChangeStaffRole — PATCH /users/:id/role с { newRole }', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: { ...USER, role: 'courier' } })))

    const { result } = renderHook(() => useChangeStaffRole(), { wrapper: makeWrapper() })
    await act(async () => { await result.current.mutateAsync({ userId: 'user-1', newRole: 'courier' }) })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${API_BASE}/api/v1/users/user-1/role`)
    expect(JSON.parse(init?.body as string)).toEqual({ newRole: 'courier' })
  })

  it('useGrantPlatformRole — POST /users/:id/grant-platform-role с { role, reason }', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: { ...USER, role: 'support_agent' } })))

    const { result } = renderHook(() => useGrantPlatformRole(), { wrapper: makeWrapper() })
    await act(async () => {
      await result.current.mutateAsync({ userId: 'user-1', role: 'support_agent', reason: 'onboarding new hire' })
    })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${API_BASE}/api/v1/users/user-1/grant-platform-role`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ role: 'support_agent', reason: 'onboarding new hire' })
  })
})
