import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { getClientEnv } from '@/shared/config/env'
import MapPage from './map-page'

/**
 * `map-page.spec.tsx` (DTJ-199).
 *
 * `maplibre-gl` мокается тем же способом, что и `features/pharmacy-map/ui/map-view.spec.tsx`
 * (`vi.hoisted` + `vi.mock`) — реальный WebGL-рендер недоступен в jsdom. Сеть мокается через
 * `vi.stubGlobal('fetch', ...)`, как в `shared/api/http-client.spec.ts` (тот же слой `httpGetJson`
 * → `httpRequestJson` → `fetch`, второй способ ходить в сеть не заводим).
 *
 * Тесты проверяют ПОВЕДЕНИЕ экрана (какое состояние показано и что реально ушло в fetch), а не
 * факт монтирования компонента.
 */

type Handler = (...args: unknown[]) => void

const { MockMap, MockMarker, MockPopup, createdMaps, createdMarkers } = vi.hoisted(() => {
  interface MockMapOptions {
    readonly container: HTMLElement
  }

  const maps: InstanceType<typeof MapImpl>[] = []
  const markers: InstanceType<typeof MarkerImpl>[] = []

  class MapImpl {
    private readonly handlers = new Map<string, Set<Handler>>()
    private bounds = { west: 68.65, south: 38.48, east: 68.92, north: 38.64 }

    constructor(_options: MockMapOptions) {
      maps.push(this)
    }

    on(event: string, handler: Handler): this {
      const set = this.handlers.get(event) ?? new Set<Handler>()
      set.add(handler)
      this.handlers.set(event, set)
      return this
    }

    off(event: string, handler: Handler): this {
      this.handlers.get(event)?.delete(handler)
      return this
    }

    getBounds(): { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number } {
      const { bounds } = this
      return {
        getWest: () => bounds.west,
        getSouth: () => bounds.south,
        getEast: () => bounds.east,
        getNorth: () => bounds.north,
      }
    }

    setBounds(next: { west: number; south: number; east: number; north: number }): void {
      this.bounds = next
    }

    remove(): void {
      // намеренно пусто
    }

    fire(event: string): void {
      this.handlers.get(event)?.forEach((handler) => {
        handler()
      })
    }
  }

  class MarkerImpl {
    public readonly element = document.createElement('div')

    constructor(_options?: { readonly color?: string }) {
      markers.push(this)
    }

    setLngLat(): this {
      return this
    }

    addTo(): this {
      return this
    }

    getElement(): HTMLElement {
      return this.element
    }

    remove(): void {
      // намеренно пусто
    }
  }

  class PopupImpl {
    setLngLat(): this {
      return this
    }

    setDOMContent(): this {
      return this
    }

    addTo(): this {
      return this
    }

    on(): this {
      return this
    }
  }

  return { MockMap: MapImpl, MockMarker: MarkerImpl, MockPopup: PopupImpl, createdMaps: maps, createdMarkers: markers }
})

vi.mock('maplibre-gl', () => ({ Map: MockMap, Marker: MockMarker, Popup: MockPopup }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const mapApiUrl = `${getClientEnv().apiBaseUrl}/api/v1/pharmacies/map`
const DEBOUNCE_MS = 400

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

async function waitForInitialMap(): Promise<InstanceType<typeof MockMap>> {
  await waitFor(() => {
    expect(createdMaps.length).toBeGreaterThan(0)
  })
  const map = createdMaps[createdMaps.length - 1]!
  act(() => {
    map.fire('load')
  })
  return map
}

beforeEach(() => {
  vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
  createdMaps.length = 0
  createdMarkers.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('MapPage (DTJ-199)', () => {
  it('1. загрузка — карта смонтирована сразу, баннер загрузки виден до ответа API', async () => {
    let resolveFetch: (response: Response) => void = () => undefined
    stubFetchOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )

    renderMapPage()
    await waitForInitialMap()

    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('map-page-loading')).toBeInTheDocument()

    await act(async () => {
      resolveFetch(jsonResponse({ data: [] }))
      await Promise.resolve()
    })
  })

  it('2. пустой результат — сообщение "аптек не найдено", карта остаётся интерактивной', async () => {
    stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [] })))

    renderMapPage()
    await waitForInitialMap()

    await waitFor(() => {
      expect(screen.getByTestId('map-page-empty')).toBeInTheDocument()
    })
    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('map-page-loading')).not.toBeInTheDocument()
  })

  it('3. ошибка сети — сообщение об ошибке + кнопка "Повторить" вызывает повторный fetch', async () => {
    const fetchMock = stubFetchOnce(() => Promise.reject(new TypeError('network down')))

    renderMapPage()
    await waitForInitialMap()

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
    const errorBody = { error: { code: 'VALIDATION_ERROR', message: 'bbox too large', details: { field: 'bbox' } } }
    stubFetchOnce(() => Promise.resolve(jsonResponse(errorBody, 400)))

    renderMapPage()
    await waitForInitialMap()

    await waitFor(() => {
      expect(screen.getByTestId('map-page-bbox-too-large')).toBeInTheDocument()
    })
    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('map-page-error')).not.toBeInTheDocument()
    // Приблизить карту — единственный выход из этого состояния, поэтому дженерик-кнопки "Повторить" тут нет.
    expect(screen.queryByTestId('map-page-retry')).not.toBeInTheDocument()
  })

  it('5. успешная отрисовка пинов — маркеры соответствуют ответу API, баннер не показан', async () => {
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
    await waitForInitialMap()

    await waitFor(() => {
      expect(createdMarkers).toHaveLength(1)
    })
    expect(screen.queryByTestId('map-page-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-page-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-page-loading')).not.toBeInTheDocument()
  })

  it('6. панорамирование карты — новый запрос уходит с новым bbox (через debounce use-map-viewport)', async () => {
    const fetchMock = stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [] })))

    renderMapPage()
    const map = await waitForInitialMap()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [initialUrl] = fetchMock.mock.calls[0] ?? []
    expect(initialUrl?.startsWith(mapApiUrl)).toBe(true)

    map.setBounds({ west: 69.0, south: 38.9, east: 69.2, north: 39.0 })
    act(() => {
      map.fire('moveend')
    })

    // Дебаунс use-map-viewport (400мс) — реальное время, а не fake timers: смешивать
    // vi.useFakeTimers с testing-library waitFor на уровне целой страницы ненадёжно.
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      },
      { timeout: DEBOUNCE_MS + 500 },
    )
    const [secondUrl] = fetchMock.mock.calls[1] ?? []
    expect(secondUrl).toContain(encodeURIComponent('69,38.9,69.2,39'))
  })

  it('7. medicineId из query-строки страницы передаётся в запрос API', async () => {
    const fetchMock = stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [] })))

    renderMapPage('/map?medicineId=22222222-2222-2222-2222-222222222222')
    await waitForInitialMap()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain('medicineId=22222222-2222-2222-2222-222222222222')
  })
})
