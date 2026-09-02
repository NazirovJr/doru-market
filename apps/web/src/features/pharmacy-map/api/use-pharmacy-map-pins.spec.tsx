import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getClientEnv } from '@/shared/config/env'
import { HttpError } from '@/shared/api/http-client'
import { usePharmacyMapPins } from './use-pharmacy-map-pins'

/**
 * `use-pharmacy-map-pins.spec.ts` (DTJ-199).
 *
 * Мокает `fetch` напрямую (тот же подход, что и `shared/api/http-client.spec.ts`) — проверяет,
 * что хук реально бьёт в `GET /api/v1/pharmacies/map` с сериализованным `bbox`/`medicineId`, а
 * не просто вызывается без ошибок.
 */

const mapApiUrl = `${getClientEnv().apiBaseUrl}/api/v1/pharmacies/map`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const bbox = { lonMin: 68.65, latMin: 38.48, lonMax: 68.92, latMax: 38.64 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePharmacyMapPins (DTJ-199)', () => {
  it('1. bbox сериализуется в query-строку "lonMin,latMin,lonMax,latMax", medicineId опущен когда не задан', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    const { result } = renderHook(() => usePharmacyMapPins({ bbox }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${mapApiUrl}?bbox=${encodeURIComponent('68.65,38.48,68.92,38.64')}`)
  })

  it('2. medicineId передаётся отдельным query-параметром, когда задан', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))
    const medicineId = '22222222-2222-2222-2222-222222222222'

    const { result } = renderHook(() => usePharmacyMapPins({ bbox, medicineId }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain(`medicineId=${medicineId}`)
  })

  it('3. 400 VALIDATION_ERROR (bbox слишком большой) — ошибка несёт details.field, без ретраев', async () => {
    const errorBody = { error: { code: 'VALIDATION_ERROR', details: { field: 'bbox' } } }
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(errorBody, 400)))

    const { result } = renderHook(() => usePharmacyMapPins({ bbox }), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeInstanceOf(HttpError)
    const error = result.current.error!
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.details).toEqual({ field: 'bbox' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('4. успешный ответ с офферами возвращается как есть (data из envelope)', async () => {
    const pin = {
      pharmacyId: '11111111-1111-1111-1111-111111111111',
      name: 'Аптека №1',
      lat: 38.55,
      lon: 68.78,
      isOpenNow: true,
      is24x7: false,
      offer: { priceDiram: 1000, stockQuantity: 5, lastSyncedAt: '2026-09-01T00:00:00Z', isStale: false },
    }
    stubFetch(() => Promise.resolve(jsonResponse({ data: [pin] })))

    const { result } = renderHook(() => usePharmacyMapPins({ bbox }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual([pin])
  })
})
