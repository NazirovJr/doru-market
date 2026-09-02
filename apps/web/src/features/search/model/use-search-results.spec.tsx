import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getClientEnv } from '@/shared/config/env'
import { useSearchResults } from './use-search-results'

/**
 * `use-search-results.spec.tsx` (DTJ-193, `SRS-CAT-075/077`, `TC-CAT-025`).
 *
 * Мокает `fetch` напрямую — тот же приём, что `use-pharmacy-map-pins.spec.tsx`.
 */

const searchUrl = `${getClientEnv().apiBaseUrl}/api/v1/medicines/search`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function resultItem(medicineId: string): Record<string, unknown> {
  return {
    medicineId,
    tradeName: `Товар ${medicineId}`,
    innName: 'Вещество',
    dosageForm: 'таблетки',
    dosageStrength: '500 мг',
    imageUrl: null,
    isPrescriptionRequired: false,
    cheapestOffer: null,
    offersCountInRadius: 0,
    relevanceScore: 0.5,
  }
}

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSearchResults (DTJ-193)', () => {
  it('1. текст пуст — сеть не запрашивается, isInitialLoading=false', () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    const { result } = renderHook(() => useSearchResults(''), { wrapper })

    expect(result.current.isInitialLoading).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2. успешная первая страница — items заполнены, isDegraded=false', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [resultItem('m1')], meta: { pagination: { nextCursor: null, hasMore: false, limit: 20 } } })))

    const { result } = renderHook(() => useSearchResults('аспирин'), { wrapper })

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })
    expect(result.current.isDegraded).toBe(false)
    expect(result.current.hasNextPage).toBe(false)
  })

  it('3. пагинация — fetchNextPage дозагружает вторую страницу курсором из первой, items накапливаются', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('cursor=page-2')) {
        return Promise.resolve(
          jsonResponse({ data: [resultItem('m2')], meta: { pagination: { nextCursor: null, hasMore: false, limit: 20 } } }),
        )
      }
      return Promise.resolve(
        jsonResponse({ data: [resultItem('m1')], meta: { pagination: { nextCursor: 'page-2', hasMore: true, limit: 20 } } }),
      )
    })

    const { result } = renderHook(() => useSearchResults('аспирин'), { wrapper })

    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true)
    })
    expect(result.current.items).toHaveLength(1)

    result.current.fetchNextPage()

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2)
    })
    expect(result.current.hasNextPage).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith(`${searchUrl}?text=`) && url.includes('cursor=page-2'))).toBe(true)
  })

  it('4. сетевая/сервисная ошибка (не 503) — error установлен, isDegraded=false', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'UNKNOWN_ERROR' } }, 500)))

    const { result } = renderHook(() => useSearchResults('аспирин'), { wrapper })

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })
    expect(result.current.isDegraded).toBe(false)
  })

  it('5. деградация поиска (SRS-CAT-075) — HTTP 503 распознан как isDegraded, а не как generic error', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 503)))

    const { result } = renderHook(() => useSearchResults('аспирин'), { wrapper })

    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })
    expect(result.current.isDegraded).toBe(true)
  })

  it('6. пустой результат — items=[], без ошибки', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    const { result } = renderHook(() => useSearchResults('несуществующий'), { wrapper })

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false)
    })
    expect(result.current.items).toEqual([])
    expect(result.current.error).toBeNull()
  })
})
