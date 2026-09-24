import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventorySyncBatchListItemDto } from '@dorutj/contracts'
import { useSyncBatches, filterBatchesByChannel, useCurrentPharmacyId } from './use-sync-batches'
import { useAuthStore } from '@/shared/api/auth-store'

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

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function batchItem(
  batchId: string,
  receivedAt: string,
  overrides?: Partial<InventorySyncBatchListItemDto>,
): InventorySyncBatchListItemDto {
  return {
    batchId,
    channel: 'rest',
    syncType: 'delta',
    status: 'completed_full_success',
    totalRows: 10,
    acceptedRows: 10,
    rejectedRows: 0,
    receivedAt,
    completedAt: receivedAt,
    sourceUploadId: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('useSyncBatches — курсорная пагинация (DTJ-169)', () => {
  it('«Показать ещё» подгружает следующую страницу без дублей уже отображённых батчей', async () => {
    const fetchMock = stubFetch((input) => {
      const url = new URL(input, 'http://localhost:3000')
      const cursor = url.searchParams.get('cursor')
      if (cursor === null) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [batchItem('b1', '2026-02-01T00:00:00.000Z'), batchItem('b2', '2026-01-31T00:00:00.000Z')],
              meta: { pagination: { hasMore: true, nextCursor: 'cursor-2', limit: 2 } },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [batchItem('b3', '2026-01-30T00:00:00.000Z')],
            meta: { pagination: { hasMore: false, nextCursor: null, limit: 2 } },
          }),
          { status: 200 },
        ),
      )
    })
    const queryClient = makeQueryClient()

    const { result } = renderHook(() => useSyncBatches('all'), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.items).toHaveLength(2) })
    expect(result.current.hasNextPage).toBe(true)

    result.current.fetchNextPage()

    await waitFor(() => { expect(result.current.items).toHaveLength(3) })
    const ids = result.current.items.map((item) => item.batchId)
    expect(ids).toEqual(['b1', 'b2', 'b3'])
    expect(new Set(ids).size).toBe(3)
    expect(result.current.hasNextPage).toBe(false)

    const [secondUrl] = fetchMock.mock.calls[1] as [string]
    expect(secondUrl).toContain('cursor=cursor-2')
  })

  it('передаёт channel query-параметром в запрос (не «all»)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [], meta: { pagination: { hasMore: false, nextCursor: null, limit: 20 } } }), { status: 200 })),
    )
    const queryClient = makeQueryClient()

    const { result } = renderHook(() => useSyncBatches('excel'), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.isInitialLoading).toBe(false) })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('channel=excel')
  })
})

describe('filterBatchesByChannel', () => {
  it('«all» возвращает список без изменений', () => {
    const items = [batchItem('b1', '2026-01-01T00:00:00.000Z'), batchItem('b2', '2026-01-01T00:00:00.000Z', { channel: 'excel' })]
    expect(filterBatchesByChannel(items, 'all')).toBe(items)
  })

  it('сужает список до выбранного канала', () => {
    const items = [batchItem('b1', '2026-01-01T00:00:00.000Z'), batchItem('b2', '2026-01-01T00:00:00.000Z', { channel: 'excel' })]

    const filtered = filterBatchesByChannel(items, 'excel')

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.batchId).toBe('b2')
  })
})

describe('useCurrentPharmacyId (DTJ-169)', () => {
  function jwtWithPayload(payload: Record<string, unknown>): string {
    const base64url = (value: string): string => Buffer.from(value, 'utf-8').toString('base64url')
    return `${base64url('{}')}.${base64url(JSON.stringify(payload))}.sig`
  }

  it('декодирует pharmacyId из access-токена', () => {
    useAuthStore.setState({ accessToken: jwtWithPayload({ pharmacyId: 'ph-1' }) })
    const { result } = renderHook(() => useCurrentPharmacyId())
    expect(result.current).toBe('ph-1')
  })

  it('null при отсутствии токена/pharmacyId (super_admin)', () => {
    useAuthStore.setState({ accessToken: jwtWithPayload({ pharmacyId: null }) })
    const { result } = renderHook(() => useCurrentPharmacyId())
    expect(result.current).toBeNull()
  })
})
