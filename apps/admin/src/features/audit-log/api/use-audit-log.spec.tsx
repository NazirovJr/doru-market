import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { AuditLogEntryDto } from '@dorutj/contracts'
import { getClientEnv } from '@/shared/api/http-client'
import { useAuditLog, useAuditLogFilters } from './use-audit-log'

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

const ENTRY: AuditLogEntryDto = {
  id: 'entry-1',
  category: 'payment_override',
  entityType: 'order',
  entityId: 'order-1',
  actorUserId: 'admin-1',
  action: 'admin_payment_override',
  reason: null,
  metadata: {},
  tenantId: 'tenant-1',
  createdAt: '2026-08-15T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAuditLog', () => {
  it('GET /api/v1/audit-log с limit + непустыми фильтрами, читает pagination из meta', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: [ENTRY], meta: { pagination: { nextCursor: 'cur-1', hasMore: true, limit: 50 } } })),
    )
    const filters = { category: 'payment_override' as const, entityType: undefined, entityId: undefined, actorUserId: undefined, tenantId: undefined, createdAtFrom: '2026-08-01', createdAtTo: undefined }

    const { result } = renderHook(() => useAuditLog(filters, null), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe(`${API_BASE}/api/v1/audit-log`)
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('category')).toBe('payment_override')
    expect(url.searchParams.get('createdAtFrom')).toBe('2026-08-01')
    expect(url.searchParams.has('cursor')).toBe(false)
    expect(result.current.data).toEqual({ items: [ENTRY], nextCursor: 'cur-1', hasMore: true })
  })

  it('cursor передан — попадает в query string', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    const emptyFilters = {
      category: undefined,
      entityType: undefined,
      entityId: undefined,
      actorUserId: undefined,
      tenantId: undefined,
      createdAtFrom: undefined,
      createdAtTo: undefined,
    }

    const { result } = renderHook(() => useAuditLog(emptyFilters, 'cur-2'), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.searchParams.get('cursor')).toBe('cur-2')
    expect(result.current.data).toEqual({ items: [], nextCursor: null, hasMore: false })
  })
})

describe('useAuditLogFilters', () => {
  it('читает фильтры из URL, setFilter добавляет/убирает query-параметр', () => {
    const { result } = renderHook(() => useAuditLogFilters(), { wrapper: makeWrapper(['/admin/audit-log?category=payment_override']) })

    expect(result.current.filters.category).toBe('payment_override')

    act(() => { result.current.setFilter('entityId', 'order-1') })

    expect(result.current.filters.entityId).toBe('order-1')
  })

  it('resetFilters очищает все ключи фильтра', () => {
    const { result } = renderHook(() => useAuditLogFilters(), {
      wrapper: makeWrapper(['/admin/audit-log?category=payment_override&entityId=order-1']),
    })

    act(() => { result.current.resetFilters() })

    expect(result.current.filters.category).toBeUndefined()
    expect(result.current.filters.entityId).toBeUndefined()
  })
})
