import { act, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type * as DorutjUi from '@dorutj/ui'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { getClientEnv } from '@/shared/config/env'
import MapPage from './map-page'

/**
 * `map-page.spec.tsx` (DTJ-199/431).
 *
 * DTJ-431: `MapView` (`apps/web`) стал тонкой обёрткой над `MapView` (`@dorutj/ui`, DTJ-409) —
 * `packages/ui` собирает `maplibre-gl` в СВОЙ `dist`-чанк (не остаётся `external`, отчёт сдачи
 * DTJ-431), поэтому `vi.mock('maplibre-gl', ...)` из `apps/web` больше НЕ перехватывает
 * динамический импорт внутри уже собранного `@dorutj/ui/dist` (см. JSDoc
 * `features/pharmacy-map/ui/map-view.spec.tsx`, тот же приём здесь). Мок — на границе
 * `@dorutj/ui`: `MapView` заменяется стабом, который рендерит контейнер с тем же
 * `data-testid="map-view-canvas"` и запоминает пропы (`points`/`onViewportChange`/...) —
 * `map-page.tsx` (вне `files_owned` DTJ-431, но сломан переносом `MapView` на `packages/ui`,
 * чинится тем же тикетом) проверяется НА СВОЁМ уровне: какое состояние показано и что реально
 * ушло в `fetch`, панорамирование эмулируется прямым вызовом захваченного `onViewportChange`
 * (форма вызова у настоящего `@dorutj/ui/MapView` покрыта его собственными 370 тестами).
 */

interface CapturedUiMapViewProps {
  readonly points: readonly { readonly id: string; readonly lat: number; readonly lng: number; readonly label?: string }[]
  readonly onViewportChange?: (bbox: { lonMin: number; latMin: number; lonMax: number; latMax: number }) => void
}

const { capturedProps, UiMapViewStub } = vi.hoisted(() => {
  const captured: { current: CapturedUiMapViewProps | undefined } = { current: undefined }
  const Stub = (props: CapturedUiMapViewProps): ReactElement => {
    captured.current = props
    return <div data-testid="map-view-canvas" />
  }
  return { capturedProps: captured, UiMapViewStub: Stub }
})

vi.mock('@dorutj/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof DorutjUi>()
  return { ...actual, MapView: UiMapViewStub }
})

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const mapApiUrl = `${getClientEnv().apiBaseUrl}/api/v1/pharmacies/map`

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetchOnce(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderMapPage(initialEntry = '/map'): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/map" element={<MapPage />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  capturedProps.current = undefined
  document.body.innerHTML = ''
})

describe('MapPage (DTJ-199/431)', () => {
  it('1. загрузка — карта смонтирована сразу, баннер загрузки виден до ответа API', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    let resolveFetch: (response: Response) => void = () => undefined
    stubFetchOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )

    renderMapPage()

    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('map-page-loading')).toBeInTheDocument()

    await act(async () => {
      resolveFetch(jsonResponse({ data: [] }))
      await Promise.resolve()
    })
  })

  it('2. пустой результат — сообщение "аптек не найдено", карта остаётся интерактивной', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [] })))

    renderMapPage()

    await waitFor(() => {
      expect(screen.getByTestId('map-page-empty')).toBeInTheDocument()
    })
    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('map-page-loading')).not.toBeInTheDocument()
  })

  it('3. ошибка сети — сообщение об ошибке + кнопка "Повторить" вызывает повторный fetch', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const fetchMock = stubFetchOnce(() => Promise.reject(new TypeError('network down')))

    renderMapPage()

    await waitFor(() => {
      expect(screen.getByTestId('map-page-error')).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse({ data: [] })))
    fireEvent.click(screen.getByTestId('map-page-retry'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('4. bbox превышает лимит площади (400 VALIDATION_ERROR field=bbox) — понятное сообщение, не белый экран', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const errorBody = { error: { code: 'VALIDATION_ERROR', message: 'bbox too large', details: { field: 'bbox' } } }
    stubFetchOnce(() => Promise.resolve(jsonResponse(errorBody, 400)))

    renderMapPage()

    await waitFor(() => {
      expect(screen.getByTestId('map-page-bbox-too-large')).toBeInTheDocument()
    })
    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('map-page-error')).not.toBeInTheDocument()
    // Приблизить карту — единственный выход из этого состояния, поэтому дженерик-кнопки "Повторить" тут нет.
    expect(screen.queryByTestId('map-page-retry')).not.toBeInTheDocument()
  })

  it('5. успешная отрисовка пинов — пины из ответа API попадают в points (@dorutj/ui MapView), баннер не показан', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const pin = {
      pharmacyId: '11111111-1111-1111-1111-111111111111',
      name: 'Аптека №1',
      lat: 38.55,
      lon: 68.78,
      isOpenNow: true,
      is24x7: false,
      offer: null,
    }
    stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [pin] })))

    renderMapPage()

    await waitFor(() => {
      expect(capturedProps.current?.points).toEqual([{ id: pin.pharmacyId, lat: pin.lat, lng: pin.lon, label: pin.name }])
    })
    expect(screen.queryByTestId('map-page-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-page-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-page-loading')).not.toBeInTheDocument()
  })

  it('6. панорамирование карты — новый запрос уходит с новым bbox (onViewportChange, debounce внутри @dorutj/ui MapView)', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const fetchMock = stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [] })))

    renderMapPage()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [initialUrl] = fetchMock.mock.calls[0] ?? []
    expect(initialUrl?.startsWith(mapApiUrl)).toBe(true)

    // Debounce/извлечение bbox — ответственность MapView (@dorutj/ui, покрыто там же); здесь
    // проверяется, что MapPage правильно реагирует на УЖЕ debounce-нутый вызов колбэка.
    act(() => {
      capturedProps.current?.onViewportChange?.({ lonMin: 69.0, latMin: 38.9, lonMax: 69.2, latMax: 39.0 })
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    const [secondUrl] = fetchMock.mock.calls[1] ?? []
    expect(secondUrl).toContain(encodeURIComponent('69,38.9,69.2,39'))
  })

  it('7. medicineId из query-строки страницы передаётся в запрос API', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    const fetchMock = stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [] })))

    renderMapPage('/map?medicineId=22222222-2222-2222-2222-222222222222')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain('medicineId=22222222-2222-2222-2222-222222222222')
  })
})
