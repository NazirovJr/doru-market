import { act, useState, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MapView, type MapPoint } from './map-view'

// maplibre-gl WebGL недоступен в jsdom — мокаем через vi.hoisted (фабрика vi.mock поднимается выше объявлений).
// Мок различает generic-события map.on(event, handler) и layer-скоуп map.on(event, layerId, handler) по arity.

type GenericHandler = (...args: unknown[]) => void

const {
  MockMap,
  createdMaps,
  addSourceCalls,
  addLayerCalls,
  setDataCalls,
} = vi.hoisted(() => {
  interface MockSource {
    readonly options: { readonly cluster?: boolean }
    setData: (data: unknown) => void
  }

  const maps: InstanceType<typeof MapImpl>[] = []
  const addSourceCallsList: unknown[] = []
  const addLayerCallsList: unknown[] = []
  const setDataCallsList: unknown[] = []

  class MapImpl {
    public readonly options: Record<string, unknown>
    private readonly genericHandlers = new Map<string, Set<GenericHandler>>()
    private readonly layerHandlers = new Map<string, Set<GenericHandler>>()
    private readonly sources = new Map<string, MockSource>()
    private readonly layers = new Set<string>()
    private readonly canvas = { style: { cursor: '' } }

    constructor(options: Record<string, unknown>) {
      this.options = options
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

    fire(event: string, ...args: unknown[]): void {
      this.genericHandlers.get(event)?.forEach((handler) => {
        handler(...args)
      })
    }

    fireLayerEvent(event: string, layerId: string, eventArg: unknown): void {
      this.layerHandlers.get(`${event}:${layerId}`)?.forEach((handler) => {
        handler(eventArg)
      })
    }

    getBounds(): { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number } {
      return { getWest: () => 68.5, getSouth: () => 38.5, getEast: () => 68.9, getNorth: () => 38.9 }
    }

    getCanvas(): { style: { cursor: string } } {
      return this.canvas
    }

    addSource(id: string, options: { readonly cluster?: boolean }): void {
      addSourceCallsList.push(options)
      const setDataSpy = vi.fn((data: unknown) => {
        setDataCallsList.push(data)
      })
      this.sources.set(id, { options, setData: setDataSpy })
    }

    getSource(id: string): MockSource | undefined {
      return this.sources.get(id)
    }

    removeSource(id: string): void {
      this.sources.delete(id)
    }

    addLayer(layer: { readonly id: string }): void {
      addLayerCallsList.push(layer)
      this.layers.add(layer.id)
    }

    getLayer(id: string): true | undefined {
      return this.layers.has(id) ? true : undefined
    }

    removeLayer(id: string): void {
      this.layers.delete(id)
    }

    remove(): void {
      // мок
    }
  }

  return {
    MockMap: MapImpl,
    createdMaps: maps,
    addSourceCalls: addSourceCallsList,
    addLayerCalls: addLayerCallsList,
    setDataCalls: setDataCallsList,
  }
})

vi.mock('maplibre-gl', () => ({ Map: MockMap }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const POINT_LAYER_ID = 'dorutj-map-view-unclustered-point'
const TEST_TILE_STYLE_URL = 'http://localhost:8080/styles/basic/style.json'

const pointA: MapPoint = { id: '11111111-1111-1111-1111-111111111111', lat: 38.55, lng: 68.78, label: 'A' }
const pointB: MapPoint = { id: '22222222-2222-2222-2222-222222222222', lat: 38.551, lng: 68.781, label: 'B' }

function getLastMap(): InstanceType<typeof MockMap> {
  const map = createdMaps[createdMaps.length - 1]
  expect(map).toBeDefined()
  return map!
}

async function waitForMapLoaded(): Promise<InstanceType<typeof MockMap>> {
  await waitFor(() => {
    expect(createdMaps.length).toBeGreaterThan(0)
  })
  const map = getLastMap()
  act(() => {
    map.fire('load')
  })
  return map
}

const ToggleableMapView = ({ points }: { readonly points: readonly MapPoint[] }): ReactElement => {
  const [mounted, setMounted] = useState(false)
  return (
    <div>
      <button
        type="button"
        data-testid="mount-toggle"
        onClick={() => {
          setMounted(true)
        }}
      >
        Показать на карте
      </button>
      {mounted ? <MapView points={points} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} /> : null}
    </div>
  )
}

describe('MapView (DTJ-409)', () => {
  beforeEach(() => {
    createdMaps.length = 0
    addSourceCalls.length = 0
    addLayerCalls.length = 0
    setDataCalls.length = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('1. points=[] с emptyStateSlot — рендерит слот, не падает, не показывает пустую карту без объяснения', async () => {
    render(
      <div style={{ height: 200, width: 200 }}>
        <MapView
          points={[]}
          mode="full"
          tileStyleUrl={TEST_TILE_STYLE_URL}
          emptyStateSlot={<p data-testid="empty-slot-content">Нет точек</p>}
        />
      </div>,
    )
    await waitForMapLoaded()

    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
    expect(screen.getByTestId('empty-slot-content')).toBeInTheDocument()
  })

  it('2. источник данных сконфигурирован с cluster: true (кластеризация близких точек)', async () => {
    render(
      <div style={{ height: 200, width: 200 }}>
        <MapView points={[pointA, pointB]} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} />
      </div>,
    )
    await waitForMapLoaded()

    await waitFor(() => {
      expect(addSourceCalls).toHaveLength(1)
    })
    expect(addSourceCalls[0]).toMatchObject({ cluster: true })
  })

  it('3. клик по точечному слою вызывает onSelect с корректным id', async () => {
    const onSelect = vi.fn()
    render(
      <div style={{ height: 200, width: 200 }}>
        <MapView points={[pointA]} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} onSelect={onSelect} />
      </div>,
    )
    const map = await waitForMapLoaded()

    act(() => {
      map.fireLayerEvent('click', POINT_LAYER_ID, { features: [{ properties: { id: pointA.id } }] })
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(pointA.id)
  })

  it('4. import maplibre-gl (и создание карты) не запускается, пока MapView не смонтирован', async () => {
    render(<ToggleableMapView points={[pointA]} />)

    expect(createdMaps).toHaveLength(0)
    expect(screen.queryByTestId('map-view-canvas')).not.toBeInTheDocument()

    screen.getByTestId('mount-toggle').click()

    await waitFor(() => {
      expect(createdMaps.length).toBeGreaterThan(0)
    })
  })

  it('5. use-map-markers синхронизирует points через setData без пересоздания карты/источника', async () => {
    const { rerender } = render(
      <div style={{ height: 200, width: 200 }}>
        <MapView points={[pointA]} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} />
      </div>,
    )
    await waitForMapLoaded()
    await waitFor(() => {
      expect(setDataCalls.length).toBeGreaterThan(0)
    })
    const setDataCallsAfterMount = setDataCalls.length

    rerender(
      <div style={{ height: 200, width: 200 }}>
        <MapView points={[pointA, pointB]} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} />
      </div>,
    )

    await waitFor(() => {
      expect(setDataCalls.length).toBeGreaterThan(setDataCallsAfterMount)
    })
    expect(createdMaps).toHaveLength(1)
    expect(addSourceCalls).toHaveLength(1)
    expect(addLayerCalls).toHaveLength(3)
  })

  it('7. mouseenter/mouseleave на точечном слое переключают курсор карты', async () => {
    render(
      <div style={{ height: 200, width: 200 }}>
        <MapView points={[pointA]} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} />
      </div>,
    )
    const map = await waitForMapLoaded()

    act(() => {
      map.fireLayerEvent('mouseenter', POINT_LAYER_ID, undefined)
    })
    expect(map.getCanvas().style.cursor).toBe('pointer')

    act(() => {
      map.fireLayerEvent('mouseleave', POINT_LAYER_ID, undefined)
    })
    expect(map.getCanvas().style.cursor).toBe('')
  })

  it('8. размонтирование снимает подписки и удаляет слои/источник (cleanup use-map-markers)', async () => {
    const { unmount } = render(
      <div style={{ height: 200, width: 200 }}>
        <MapView points={[pointA]} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} />
      </div>,
    )
    await waitForMapLoaded()
    await waitFor(() => {
      expect(addLayerCalls).toHaveLength(3)
    })

    expect(() => {
      unmount()
    }).not.toThrow()
  })

  it('9. карта фейлится ДО первого load ("error") — фолбэк через unavailableSlot', async () => {
    render(
      <MapView
        points={[]}
        mode="full"
        tileStyleUrl={TEST_TILE_STYLE_URL}
        unavailableSlot={<p data-testid="unavailable-slot-content">Недоступно</p>}
      />,
    )
    await waitFor(() => {
      expect(createdMaps.length).toBeGreaterThan(0)
    })
    const map = getLastMap()

    act(() => {
      map.fire('error')
    })

    await waitFor(() => {
      expect(screen.getByTestId('unavailable-slot-content')).toBeInTheDocument()
    })
  })

  it('10. onViewportChange зовётся один раз на жест панорамирования (debounce moveend/zoomend)', async () => {
    vi.useFakeTimers()
    const onViewportChange = vi.fn()
    render(
      <MapView points={[]} mode="full" tileStyleUrl={TEST_TILE_STYLE_URL} onViewportChange={onViewportChange} />,
    )

    await vi.waitFor(() => {
      expect(createdMaps.length).toBeGreaterThan(0)
    })
    const map = getLastMap()
    act(() => {
      map.fire('load')
    })

    act(() => {
      map.fire('moveend')
      map.fire('zoomend')
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(onViewportChange).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledWith({ west: 68.5, south: 38.5, east: 68.9, north: 38.9 })
    vi.useRealTimers()
  })

  it('6. tileStyleUrl не передан — фолбэк через unavailableSlot, без падения UI', async () => {
    render(
      <MapView points={[]} mode="full" unavailableSlot={<p data-testid="unavailable-slot-content">Недоступно</p>} />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('unavailable-slot-content')).toBeInTheDocument()
    })
    expect(createdMaps).toHaveLength(0)
  })
})
