import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { MapView, type MapPin } from './map-view'

/**
 * `map-view.spec.tsx` (DTJ-198, тест-план: «монтирование без ошибок, рендер N маркеров по
 * пропсам, попап без XSS»). `maplibre-gl` реально WebGL-рендерит в браузере — недоступно в jsdom,
 * поэтому пакет мокается локальным фейком через `vi.hoisted` (обязателен для vi.mock — фабрика
 * поднимается ВЫШЕ обычных объявлений модуля, поэтому классы мока должны быть подняты тем же
 * механизмом, иначе ссылка на них из фабрики упадёт с ReferenceError).
 */

type Handler = (...args: unknown[]) => void

const { MockMap, MockMarker, MockPopup, createdMaps, createdMarkers } = vi.hoisted(() => {
  interface MockMapOptions {
    readonly container: HTMLElement
    readonly style: string
    readonly center: readonly [number, number]
    readonly zoom: number
    readonly minZoom?: number
  }

  const maps: InstanceType<typeof MapImpl>[] = []
  const markers: InstanceType<typeof MarkerImpl>[] = []

  class MapImpl {
    public readonly options: MockMapOptions
    private readonly handlers = new Map<string, Set<Handler>>()

    constructor(options: MockMapOptions) {
      this.options = options
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
      return { getWest: () => 68.5, getSouth: () => 38.5, getEast: () => 68.9, getNorth: () => 38.9 }
    }

    remove(): void {
      // намеренно пусто: мок не держит реальных ресурсов
    }

    fire(event: string, ...args: unknown[]): void {
      this.handlers.get(event)?.forEach((handler) => {
        handler(...args)
      })
    }
  }

  class MarkerImpl {
    public readonly element = document.createElement('div')
    public lngLat: readonly [number, number] | undefined
    public removed = false

    constructor(_options?: { readonly color?: string }) {
      markers.push(this)
    }

    setLngLat(lngLat: readonly [number, number]): this {
      this.lngLat = lngLat
      return this
    }

    addTo(): this {
      return this
    }

    getElement(): HTMLElement {
      return this.element
    }

    remove(): void {
      this.removed = true
    }
  }

  class PopupImpl {
    public domContent: HTMLElement | undefined
    private readonly handlers = new Map<string, Set<Handler>>()

    setLngLat(): this {
      return this
    }

    setDOMContent(node: HTMLElement): this {
      this.domContent = node
      document.body.appendChild(node)
      return this
    }

    addTo(): this {
      return this
    }

    on(event: string, handler: Handler): this {
      const set = this.handlers.get(event) ?? new Set<Handler>()
      set.add(handler)
      this.handlers.set(event, set)
      return this
    }
  }

  return { MockMap: MapImpl, MockMarker: MarkerImpl, MockPopup: PopupImpl, createdMaps: maps, createdMarkers: markers }
})

vi.mock('maplibre-gl', () => ({ Map: MockMap, Marker: MockMarker, Popup: MockPopup }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const pin1: MapPin = {
  pharmacyId: '11111111-1111-1111-1111-111111111111',
  name: 'Аптека №1',
  lat: 38.55,
  lon: 68.78,
  isOpenNow: true,
  is24x7: false,
  offer: { priceDiram: 12550, stockQuantity: 7, lastSyncedAt: '2026-08-30T10:00:00Z', isStale: false },
}
const pin2: MapPin = { ...pin1, pharmacyId: '22222222-2222-2222-2222-222222222222', name: 'Аптека №2', offer: null }
const pin3: MapPin = { ...pin1, pharmacyId: '33333333-3333-3333-3333-333333333333', name: 'Аптека №3' }

function renderMap(pins: readonly MapPin[]): ReturnType<typeof render> {
  return render(
    <LocaleProvider>
      <div style={{ height: 200, width: 200 }}>
        <MapView center={{ lon: 68.78, lat: 38.55 }} zoom={12} pins={pins} />
      </div>
    </LocaleProvider>,
  )
}

function assertDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined()
  return value as T
}

async function waitForMapLoaded(): Promise<InstanceType<typeof MockMap>> {
  await waitFor(() => {
    expect(createdMaps.length).toBeGreaterThan(0)
  })
  const map = assertDefined(createdMaps[createdMaps.length - 1])
  act(() => {
    map.fire('load')
  })
  return map
}

describe('MapView (DTJ-198)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_TILESERVER_URL', 'http://localhost:8080/styles/basic/style.json')
    createdMaps.length = 0
    createdMarkers.length = 0
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    document.body.innerHTML = ''
  })

  it('1. pins=[] — рендерится без console-ошибок, без маркеров', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderMap([])
    await waitForMapLoaded()

    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(createdMarkers).toHaveLength(0)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('2. pins с 3 элементами — 3 маркера в соответствующих координатах', async () => {
    renderMap([pin1, pin2, pin3])
    await waitForMapLoaded()

    await waitFor(() => {
      expect(createdMarkers).toHaveLength(3)
    })
    expect(createdMarkers.map((marker) => marker.lngLat)).toEqual([
      [pin1.lon, pin1.lat],
      [pin2.lon, pin2.lat],
      [pin3.lon, pin3.lat],
    ])
  })

  it('3. клик по маркеру с offer !== null — попап открывается с ценой, остатком, именем', async () => {
    renderMap([pin1])
    await waitForMapLoaded()
    await waitFor(() => {
      expect(createdMarkers).toHaveLength(1)
    })

    act(() => {
      assertDefined(createdMarkers[0])
        .getElement()
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('pharmacy-pin-popup')).toBeInTheDocument()
    })
    expect(screen.getByText(pin1.name)).toBeInTheDocument()
    expect(screen.getByTestId('pharmacy-pin-popup-price')).toHaveTextContent('125.50')
  })

  it('4. имя аптеки со спецсимволами в попапе не создаёт реальный <script> в DOM', async () => {
    const maliciousPin: MapPin = { ...pin1, name: '<script>window.__xssFired = true</script>' }
    renderMap([maliciousPin])
    await waitForMapLoaded()
    await waitFor(() => {
      expect(createdMarkers).toHaveLength(1)
    })

    act(() => {
      assertDefined(createdMarkers[0])
        .getElement()
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('pharmacy-pin-popup')).toBeInTheDocument()
    })
    expect(document.querySelector('script')).not.toBeInTheDocument()
    expect((window as { __xssFired?: boolean }).__xssFired).toBeUndefined()
  })

  it('5. VITE_TILESERVER_URL не задан — фолбэк «карта недоступна», без падения UI', async () => {
    vi.stubEnv('VITE_TILESERVER_URL', '')
    renderMap([])

    await waitFor(() => {
      expect(screen.getByTestId('map-view-unavailable')).toBeInTheDocument()
    })
    expect(createdMaps).toHaveLength(0)
  })

  it('6. карта фейлится ДО первого load ("error") — фолбэк «карта недоступна»', async () => {
    renderMap([])
    await waitFor(() => {
      expect(createdMaps.length).toBeGreaterThan(0)
    })
    const map = assertDefined(createdMaps[createdMaps.length - 1])

    act(() => {
      map.fire('error')
    })

    await waitFor(() => {
      expect(screen.getByTestId('map-view-unavailable')).toBeInTheDocument()
    })
  })
})
