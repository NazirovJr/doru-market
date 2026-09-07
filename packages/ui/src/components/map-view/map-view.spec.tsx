import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { MAP_CLUSTER_LAYER_ID, MAP_POINTS_SOURCE_ID, MAP_POINT_LAYER_ID } from './use-map-markers.js'
import { MapView, type MapPoint } from './map-view.js'

/**
 * `map-view.spec.tsx` (DTJ-409). `maplibre-gl` требует WebGL, недоступный в `jsdom` — здесь
 * НЕ рендерится настоящая карта, весь модуль `maplibre-gl` замокан ниже. Проверяется СВОЙ код:
 * инициализация с ожидаемыми параметрами, синхронизация источника данных при смене `points`,
 * `remove()` при размонтировании, ленивая загрузка, клики по кластеру/точке. Визуальный
 * WebGL-рендер и реальная кластеризация пикселей — вне охвата unit-тестов, см. `map-view.stories.tsx`
 * (ручная/E2E-проверка в браузере, отчёт сдачи DTJ-409 «Границы проверок»).
 */

type Handler = (event?: unknown) => void

class FakeGeoJSONSource {
  lastData: unknown
  setData(data: unknown): void {
    this.lastData = data
  }
  getClusterExpansionZoom(_clusterId: number): Promise<number> {
    return Promise.resolve(14)
  }
}

class FakeMap {
  static instances: FakeMap[] = []
  /** Переключатель для теста "падение инициализации карты не роняет компонент" — имитирует
   * реальный сбой (сеть/WebGL недоступен) без пересборки модульного графа `vi.doMock`. */
  static shouldThrowOnConstruct = false
  readonly options: Record<string, unknown>
  readonly sources = new globalThis.Map<string, FakeGeoJSONSource>()
  readonly addedLayers: Record<string, unknown>[] = []
  readonly handlers = new globalThis.Map<string, Set<Handler>>()
  removed = false
  scrollZoom = { disable: vi.fn(), enable: vi.fn() }
  fitBounds = vi.fn()
  easeTo = vi.fn()
  queryRenderedFeatures = vi.fn(() => [] as { properties: Record<string, unknown>; geometry: unknown }[])

  constructor(options: Record<string, unknown>) {
    if (FakeMap.shouldThrowOnConstruct) {
      throw new Error('simulated maplibre-gl init failure')
    }
    this.options = options
    FakeMap.instances.push(this)
  }

  private key(type: string, layer: string | undefined): string {
    return layer === undefined ? type : `${type}:${layer}`
  }

  on(type: string, layerOrHandler: string | Handler, maybeHandler?: Handler): this {
    const isDelegated = typeof layerOrHandler === 'string'
    const handler = isDelegated ? (maybeHandler!) : layerOrHandler
    const key = this.key(type, isDelegated ? layerOrHandler : undefined)
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set())
    }
    this.handlers.get(key)?.add(handler)
    if (type === 'load') {
      queueMicrotask(() => {
        handler()
      })
    }
    return this
  }

  off(type: string, layerOrHandler: string | Handler, maybeHandler?: Handler): this {
    const isDelegated = typeof layerOrHandler === 'string'
    const handler = isDelegated ? (maybeHandler!) : layerOrHandler
    this.handlers.get(this.key(type, isDelegated ? layerOrHandler : undefined))?.delete(handler)
    return this
  }

  emit(type: string, layer: string | undefined, event: unknown): void {
    this.handlers.get(this.key(type, layer))?.forEach((handler) => {
      handler(event)
    })
  }

  addSource(id: string, spec: { data: unknown; cluster?: boolean }): void {
    const source = new FakeGeoJSONSource()
    source.setData(spec.data)
    this.sources.set(id, source)
    ;(this as unknown as { lastAddSourceSpec: unknown }).lastAddSourceSpec = spec
  }

  getSource(id: string): FakeGeoJSONSource | undefined {
    return this.sources.get(id)
  }

  addLayer(layer: Record<string, unknown>): this {
    this.addedLayers.push(layer)
    return this
  }

  remove(): void {
    this.removed = true
  }

  getBounds(): { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number } {
    return { getWest: () => 68.6, getSouth: () => 38.4, getEast: () => 68.9, getNorth: () => 38.6 }
  }
}

vi.mock('maplibre-gl', () => ({ Map: FakeMap }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

const PHARM_1: MapPoint = { id: 'pharm-1', lat: 38.559, lng: 68.787, label: 'Аптека 1' }
const PHARM_2: MapPoint = { id: 'pharm-2', lat: 38.5591, lng: 68.7871, label: 'Аптека 2' }
const POINTS: readonly MapPoint[] = [PHARM_1, PHARM_2]

async function flushLazyLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Единственный созданный `FakeMap` за тест (после `flushLazyLoad`) — бросает с понятным
 * сообщением вместо `TypeError` на `undefined`, если карта почему-то не создалась. */
function getMap(): FakeMap {
  const map = FakeMap.instances[0]
  if (map === undefined) {
    throw new Error('FakeMap instance was not created')
  }
  return map
}

beforeEach(() => {
  FakeMap.instances.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('MapView — пустое состояние (критерий приёмки 1)', () => {
  it('points=[] и передан emptyStateSlot — рендерит слот, не монтирует карту', async () => {
    render(<MapView points={[]} mode="full" emptyStateSlot={<p>Ничего не найдено</p>} />)

    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    expect(screen.queryByTestId('map-view-canvas')).not.toBeInTheDocument()

    await flushLazyLoad()
    expect(FakeMap.instances).toHaveLength(0)
  })

  it('points=[] без emptyStateSlot — не падает, рендерит контейнер карты (не пустая заглушка без объяснения)', () => {
    expect(() => render(<MapView points={[]} mode="full" />)).not.toThrow()
    expect(screen.getByTestId('map-view-canvas')).toBeInTheDocument()
  })
})

describe('MapView — ленивая загрузка maplibre-gl (критерий приёмки 3)', () => {
  it('не создаёт карту, пока компонент не смонтирован', () => {
    expect(FakeMap.instances).toHaveLength(0)
  })

  it('монтирование запускает динамический import() и создаёт РОВНО ОДИН экземпляр карты', async () => {
    render(<MapView points={POINTS} mode="full" />)
    expect(FakeMap.instances).toHaveLength(0)

    await flushLazyLoad()

    expect(FakeMap.instances).toHaveLength(1)
  })

  it('размонтирование вызывает map.remove() (утечка карты — реальный баг)', async () => {
    const { unmount } = render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()
    const map = getMap()
    expect(map.removed).toBe(false)

    unmount()

    expect(map.removed).toBe(true)
  })
})

describe('MapView — кластеризация (критерий приёмки 2)', () => {
  it('источник данных сконфигурирован с cluster: true (встроенная кластеризация MapLibre)', async () => {
    render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()

    const map = getMap()
    const spec = (map as unknown as { lastAddSourceSpec: { cluster?: boolean } }).lastAddSourceSpec
    expect(spec.cluster).toBe(true)
    expect(map.addedLayers.some((layer) => layer.id === MAP_CLUSTER_LAYER_ID)).toBe(true)
  })

  it('клик по кластеру приближает карту (easeTo), не вызывает onSelect', async () => {
    const onSelect = vi.fn()
    render(<MapView points={POINTS} mode="full" onSelect={onSelect} />)
    await flushLazyLoad()

    const map = getMap()
    map.queryRenderedFeatures = vi.fn(() => [
      { properties: { cluster_id: 7 }, geometry: { type: 'Point', coordinates: [68.787, 38.559] } },
    ])

    await act(async () => {
      map.emit('click', MAP_CLUSTER_LAYER_ID, { point: { x: 0, y: 0 } })
      await Promise.resolve()
    })

    expect(map.easeTo).toHaveBeenCalledWith({ center: [68.787, 38.559], zoom: 14 })
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('MapView — выбор точки (критерий приёмки 4)', () => {
  it('клик по точке вызывает onSelect с корректным id', async () => {
    const onSelect = vi.fn()
    render(<MapView points={POINTS} mode="full" onSelect={onSelect} />)
    await flushLazyLoad()

    const map = getMap()
    map.emit('click', MAP_POINT_LAYER_ID, { features: [{ properties: { id: 'pharm-2' } }] })

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('pharm-2')
  })

  it('без onSelect — клик по точке не падает', async () => {
    render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()

    const map = getMap()
    expect(() => {
      map.emit('click', MAP_POINT_LAYER_ID, { features: [{ properties: { id: 'pharm-1' } }] })
    }).not.toThrow()
  })
})

describe('use-map-markers — синхронизация points без пересоздания карты', () => {
  it('смена points вызывает ТОЛЬКО source.setData, карта не пересоздаётся', async () => {
    const { rerender } = render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()

    expect(FakeMap.instances).toHaveLength(1)
    const map = getMap()
    const layerCountBefore = map.addedLayers.length

    const nextPoints: readonly MapPoint[] = [...POINTS, { id: 'pharm-3', lat: 38.56, lng: 68.79 }]
    rerender(<MapView points={nextPoints} mode="full" />)

    expect(FakeMap.instances).toHaveLength(1)
    expect(map.addedLayers).toHaveLength(layerCountBefore)
    const source = map.getSource(MAP_POINTS_SOURCE_ID)
    const data = source?.lastData as { features: unknown[] }
    expect(data.features).toHaveLength(3)
  })

  it('points опустевают до [] на смонтированной карте — источник получает пустую коллекцию', async () => {
    const { rerender } = render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()
    const map = getMap()

    rerender(<MapView points={[]} mode="full" />)

    const source = map.getSource(MAP_POINTS_SOURCE_ID)
    const data = source?.lastData as { features: unknown[] }
    expect(data.features).toHaveLength(0)
  })
})

describe('MapView — начальный вид без center/bbox (fallback)', () => {
  it('нет center, нет bbox, points=[] — не падает, использует нейтральный fallback-центр', async () => {
    render(<MapView points={[]} mode="full" />)
    await flushLazyLoad()

    expect(FakeMap.instances).toHaveLength(1)
    expect(getMap().options.center).toEqual([0, 0])
    expect(getMap().options.zoom).toBe(1)
  })

  it('нет center — центр вычисляется как центроид переданных points', async () => {
    render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()

    const [lng, lat] = getMap().options.center as [number, number]
    expect(lng).toBeCloseTo((PHARM_1.lng + PHARM_2.lng) / 2)
    expect(lat).toBeCloseTo((PHARM_1.lat + PHARM_2.lat) / 2)
  })
})

describe('MapView — режимы отображения', () => {
  it('mode="preview" отключает scrollZoom (карта не перехватывает скролл страницы)', async () => {
    render(<MapView points={POINTS} mode="preview" />)
    await flushLazyLoad()

    expect(getMap().scrollZoom.disable).toHaveBeenCalled()
  })

  it('mode="full" не отключает scrollZoom', async () => {
    render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()

    expect(getMap().scrollZoom.disable).not.toHaveBeenCalled()
  })

  it('bbox — карта вызывает fitBounds по границам', async () => {
    render(<MapView points={POINTS} mode="full" bbox={{ lonMin: 68.6, latMin: 38.4, lonMax: 68.9, latMax: 38.6 }} />)
    await flushLazyLoad()

    expect(getMap().fitBounds).toHaveBeenCalledWith(
      [
        [68.6, 38.4],
        [68.9, 38.6],
      ],
      { animate: false },
    )
  })

  it('className прокидывается на корневой контейнер', () => {
    const { container } = render(<MapView points={POINTS} mode="full" className="custom-map" />)
    expect(container.querySelector('.custom-map')).toBeInTheDocument()
  })

  it('[DTJ-431] minZoom прокидывается в конструктор maplibregl.Map', async () => {
    render(<MapView points={POINTS} mode="full" minZoom={9} />)
    await flushLazyLoad()
    expect(getMap().options).toMatchObject({ minZoom: 9 })
  })
})

describe('MapView — onViewportChange (DTJ-431, известное расхождение API)', () => {
  it('moveend/zoomend — один debounce-вызов onViewportChange с bbox видимой области', async () => {
    vi.useFakeTimers()
    const onViewportChange = vi.fn()
    render(<MapView points={POINTS} mode="full" onViewportChange={onViewportChange} viewportDebounceMs={50} />)
    await flushLazyLoad()
    const map = getMap()

    act(() => {
      map.emit('moveend', undefined, undefined)
      map.emit('zoomend', undefined, undefined)
    })
    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(onViewportChange).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledWith({ lonMin: 68.6, latMin: 38.4, lonMax: 68.9, latMax: 38.6 })
    vi.useRealTimers()
  })

  it('без onViewportChange — moveend не падает', async () => {
    render(<MapView points={POINTS} mode="full" />)
    await flushLazyLoad()
    expect(() => {
      getMap().emit('moveend', undefined, undefined)
    }).not.toThrow()
  })
})

describe('MapView — ошибка загрузки библиотеки не роняет компонент', () => {
  afterEach(() => {
    FakeMap.shouldThrowOnConstruct = false
  })

  it('сбой инициализации карты (сеть/WebGL) — компонент остаётся в DOM без выброшенного исключения', async () => {
    FakeMap.shouldThrowOnConstruct = true

    expect(() => render(<MapView points={POINTS} mode="full" />)).not.toThrow()
    await flushLazyLoad()

    expect(screen.getByTestId('map-view-load-error')).toBeInTheDocument()
  })
})

describe('MapView — доступность', () => {
  it('пустое состояние — ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <MapView points={[]} mode="full" emptyStateSlot={<p>Ничего не найдено</p>} />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})

describe('use-map-markers.ts экспортирует стабильные идентификаторы слоёв', () => {
  it('идентификаторы слоёв — непустые строки (используются consumer-стилями Storybook/E2E)', () => {
    expect(MAP_CLUSTER_LAYER_ID.length).toBeGreaterThan(0)
    expect(MAP_POINT_LAYER_ID.length).toBeGreaterThan(0)
    expect(MAP_POINTS_SOURCE_ID.length).toBeGreaterThan(0)
  })
})
