import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { getClientEnv } from '@/shared/config/env'
import MapPage from './map-page'

// Мок maplibre-gl — тот же приём, что в packages/ui/.../map-view.spec.tsx (addSource/addLayer/
// getSource#setData, GeoJSON-источник вместо Marker). Сеть — через vi.stubGlobal('fetch', ...).

type GenericHandler = (...args: unknown[]) => void

const { MockMap, createdMaps, setDataCalls } = vi.hoisted(() => {
  interface MockSource {
    setData: (data: unknown) => void
  }

  const maps: InstanceType<typeof MapImpl>[] = []
  const setDataCallsList: unknown[] = []

  class MapImpl {
    private readonly genericHandlers = new Map<string, Set<GenericHandler>>()
    private readonly layerHandlers = new Map<string, Set<GenericHandler>>()
    private readonly sources = new Map<string, MockSource>()
    private readonly layers = new Set<string>()
    private readonly canvas = { style: { cursor: '' } }
    private bounds = { west: 68.65, south: 38.48, east: 68.92, north: 38.64 }

    constructor(_options: Record<string, unknown>) {
      maps.push(this)
    }

    on(event: string, second: GenericHandler | string, third?: GenericHandler): this {
      if (typeof second === 'string') {
        const key = `${event}:${second}`
        const set = this.layerHandlers.get(key) ?? new Set<GenericHandler>()
        if (third !== undefined) {
          set.add(third)
        }
        this.layerHandlers.set(key, set)
        return this
      }
      const set = this.genericHandlers.get(event) ?? new Set<GenericHandler>()
      set.add(second)
      this.genericHandlers.set(event, set)
      return this
    }

    off(event: string, second: GenericHandler | string, third?: GenericHandler): this {
      if (typeof second === 'string') {
        this.layerHandlers.get(`${event}:${second}`)?.delete(third!)
        return this
      }
      this.genericHandlers.get(event)?.delete(second)
      return this
    }

    fire(event: string): void {
      this.genericHandlers.get(event)?.forEach((handler) => {
        handler()
      })
    }

    fireLayerEvent(event: string, layerId: string, eventArg: unknown): void {
      this.layerHandlers.get(`${event}:${layerId}`)?.forEach((handler) => {
        handler(eventArg)
      })
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

    getCanvas(): { style: { cursor: string } } {
      return this.canvas
    }

    addSource(id: string): void {
      const setDataSpy = vi.fn((data: unknown) => {
        setDataCallsList.push(data)
      })
      this.sources.set(id, { setData: setDataSpy })
    }

    getSource(id: string): MockSource | undefined {
      return this.sources.get(id)
    }

    removeSource(id: string): void {
      this.sources.delete(id)
    }

    addLayer(layer: { readonly id: string }): void {
      this.layers.add(layer.id)
    }

    getLayer(id: string): true | undefined {
      return this.layers.has(id) ? true : undefined
    }

    removeLayer(id: string): void {
      this.layers.delete(id)
    }

    remove(): void {
      // намеренно пусто
    }
  }

  return { MockMap: MapImpl, createdMaps: maps, setDataCalls: setDataCallsList }
})

vi.mock('maplibre-gl', () => ({ Map: MockMap }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const POINT_LAYER_ID = 'dorutj-map-view-unclustered-point'
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

function getLastMap(): InstanceType<typeof MockMap> {
  const map = createdMaps[createdMaps.length - 1]
  expect(map).toBeDefined()
  return map!
}

async function waitForInitialMap(): Promise<InstanceType<typeof MockMap>> {
  await waitFor(() => {
    expect(createdMaps.length).toBeGreaterThan(0)
  })
  const map = getLastMap()
  act(() => {
    map.fire('load')
  })
  return map
}

beforeEach(() => {
  vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
  createdMaps.length = 0
  setDataCalls.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('MapPage (DTJ-199/DTJ-409)', () => {
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

  it('5. успешная отрисовка пинов — источник карты получает точки из ответа API, баннер не показан', async () => {
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
      const lastCall = setDataCalls[setDataCalls.length - 1] as { features: readonly unknown[] } | undefined
      expect(lastCall?.features).toHaveLength(1)
    })
    expect(screen.queryByTestId('map-page-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-page-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-page-loading')).not.toBeInTheDocument()
  })

  it('6. панорамирование карты — новый запрос уходит с новым bbox (через debounce внутри MapView)', async () => {
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

    // Дебаунс внутри `MapView` (400мс) — реальное время, а не fake timers: смешивать
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

  it('8. клик по пину открывает панель выбранной аптеки снизу, закрытие панели её скрывает', async () => {
    const pin = {
      pharmacyId: '11111111-1111-1111-1111-111111111111',
      name: 'Аптека №1',
      lat: 38.55,
      lon: 68.78,
      isOpenNow: true,
      is24x7: false,
      offer: { priceDiram: 12550, stockQuantity: 7, lastSyncedAt: '2026-08-30T10:00:00Z', isStale: false },
    }
    stubFetchOnce(() => Promise.resolve(jsonResponse({ data: [pin] })))

    renderMapPage()
    const map = await waitForInitialMap()
    await waitFor(() => {
      const lastCall = setDataCalls[setDataCalls.length - 1] as { features: readonly unknown[] } | undefined
      expect(lastCall?.features).toHaveLength(1)
    })

    act(() => {
      map.fireLayerEvent('click', POINT_LAYER_ID, { features: [{ properties: { id: pin.pharmacyId } }] })
    })

    await waitFor(() => {
      expect(screen.getByTestId('map-page-selected-pharmacy')).toBeInTheDocument()
    })
    expect(screen.getByText(pin.name)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Пӯшидан' }))
    expect(screen.queryByTestId('map-page-selected-pharmacy')).not.toBeInTheDocument()
  })
})
