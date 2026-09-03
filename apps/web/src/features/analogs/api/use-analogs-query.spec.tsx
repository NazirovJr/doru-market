import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getClientEnv } from '@/shared/config/env'
import { HttpError } from '@/shared/api/http-client'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { useAnalogsQuery } from './use-analogs-query'
import type { AnalogsDataDto } from './use-analogs-query'

/**
 * `use-analogs-query.spec.tsx` (DTJ-104). Мокает `fetch` напрямую — тот же приём, что
 * `use-pharmacy-map-pins.spec.tsx` (DTJ-199) / `http-client.spec.ts`.
 */

const LOCALE_STORAGE_KEY = 'dorutj.locale'
const MEDICINE_ID = '11111111-1111-1111-1111-111111111111'
const analogsUrl = `${getClientEnv().apiBaseUrl}/api/v1/medicines/${MEDICINE_ID}/analogs`

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
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>{children}</LocaleProvider>
    </QueryClientProvider>
  )
}

const analogsData: AnalogsDataDto = {
  referenceMedicineId: MEDICINE_ID,
  items: [],
  savingsDiram: null,
  titleKey: 'catalog.analogs.title_neutral',
  disclaimer: 'Это не медицинская рекомендация.',
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('useAnalogsQuery (DTJ-104)', () => {
  it('1. без geo/radiusMeters — запрос без query-строки', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: analogsData })))

    const { result } = renderHook(() => useAnalogsQuery({ medicineId: MEDICINE_ID }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(analogsUrl)
  })

  it('2. geo сериализуется в lat/lon, radiusMeters — отдельным параметром', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: analogsData })))

    const { result } = renderHook(
      () => useAnalogsQuery({ medicineId: MEDICINE_ID, geo: { lat: 38.5598, lon: 68.787 }, radiusMeters: 3000 }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${analogsUrl}?lat=38.5598&lon=68.787&radiusMeters=3000`)
  })

  it('3. Accept-Language — локаль по умолчанию ("tj") передаётся заголовком запроса', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: analogsData })))

    const { result } = renderHook(() => useAnalogsQuery({ medicineId: MEDICINE_ID }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get('accept-language')).toBe('tj')
  })

  it('4. Accept-Language — меняется вместе с текущей локалью пользователя ("ru")', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ru')
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: analogsData })))

    const { result } = renderHook(() => useAnalogsQuery({ medicineId: MEDICINE_ID }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get('accept-language')).toBe('ru')
  })

  it('5. 404 MEDICINE_NOT_FOUND — HttpError с этим кодом и статусом, без ретраев', async () => {
    const errorBody = { error: { code: 'NOT_FOUND', message: 'medicine not found' } }
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(errorBody, 404)))

    const { result } = renderHook(() => useAnalogsQuery({ medicineId: MEDICINE_ID }), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(result.current.error).toBeInstanceOf(HttpError)
    const error = result.current.error
    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('6. успешный ответ возвращается как есть (data из конверта), включая disclaimer/titleKey', async () => {
    const data: AnalogsDataDto = {
      referenceMedicineId: MEDICINE_ID,
      items: [],
      savingsDiram: 6500,
      titleKey: 'catalog.analogs.title_savings',
      disclaimer: 'Дисклеймер с сервера.',
    }
    stubFetch(() => Promise.resolve(jsonResponse({ data })))

    const { result } = renderHook(() => useAnalogsQuery({ medicineId: MEDICINE_ID }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual(data)
  })

  it('7. пустой medicineId — запрос не отправляется (enabled: false)', () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: analogsData })))

    renderHook(() => useAnalogsQuery({ medicineId: '' }), { wrapper })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
