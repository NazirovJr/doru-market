import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useMapViewport } from './use-map-viewport'

/**
 * `use-map-viewport.spec.ts` (DTJ-198, критерий приёмки 3).
 *
 * `map` мокается локальным фейком, реализующим только используемый срез API
 * (`on`/`off`/`getBounds`) — реальный `maplibre-gl` в jsdom недоступен (тест-план тикета).
 * Файл НЕ импортирует `maplibre-gl` в рантайме: `import type` стирается сборщиком, поэтому тест
 * не зависит от того, установлен ли пакет физически.
 */

type EventHandler = () => void

class FakeMap {
  private readonly handlers = new Map<string, Set<EventHandler>>()
  private readonly bounds = { west: 68.5, south: 38.5, east: 68.9, north: 38.9 }

  on(event: string, handler: EventHandler): this {
    const set = this.handlers.get(event) ?? new Set<EventHandler>()
    set.add(handler)
    this.handlers.set(event, set)
    return this
  }

  off(event: string, handler: EventHandler): this {
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

  fire(event: string): void {
    this.handlers.get(event)?.forEach((handler) => {
      handler()
    })
  }
}

function asMapLibreMap(map: FakeMap): MapLibreMap {
  return map as unknown as MapLibreMap
}

const DEBOUNCE_MS = 400

describe('useMapViewport (DTJ-198, критерий приёмки 3)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('1. серия zoomend+moveend одного жеста схлопывается в ОДИН вызов с итоговым bbox', () => {
    vi.useFakeTimers()
    const map = new FakeMap()
    const onViewportChange = vi.fn()

    renderHook(() => {
      useMapViewport({ map: asMapLibreMap(map), onViewportChange, debounceMs: DEBOUNCE_MS })
    })

    map.fire('zoomend')
    vi.advanceTimersByTime(100)
    map.fire('moveend')
    vi.advanceTimersByTime(100)
    map.fire('moveend')
    vi.advanceTimersByTime(DEBOUNCE_MS)

    expect(onViewportChange).toHaveBeenCalledTimes(1)
    expect(onViewportChange).toHaveBeenCalledWith({
      lonMin: 68.5,
      latMin: 38.5,
      lonMax: 68.9,
      latMax: 38.9,
    })
  })

  it('2. до истечения debounce onViewportChange не вызван', () => {
    vi.useFakeTimers()
    const map = new FakeMap()
    const onViewportChange = vi.fn()

    renderHook(() => {
      useMapViewport({ map: asMapLibreMap(map), onViewportChange, debounceMs: DEBOUNCE_MS })
    })

    map.fire('moveend')
    vi.advanceTimersByTime(DEBOUNCE_MS - 1)

    expect(onViewportChange).not.toHaveBeenCalled()
  })

  it('3. map=null — подписка не создаётся, onViewportChange никогда не вызывается', () => {
    vi.useFakeTimers()
    const onViewportChange = vi.fn()

    renderHook(() => {
      useMapViewport({ map: null, onViewportChange, debounceMs: DEBOUNCE_MS })
    })
    vi.advanceTimersByTime(DEBOUNCE_MS * 2)

    expect(onViewportChange).not.toHaveBeenCalled()
  })

  it('4. unmount до истечения debounce отменяет отложенный вызов', () => {
    vi.useFakeTimers()
    const map = new FakeMap()
    const onViewportChange = vi.fn()

    const { unmount } = renderHook(() => {
      useMapViewport({ map: asMapLibreMap(map), onViewportChange, debounceMs: DEBOUNCE_MS })
    })

    map.fire('moveend')
    unmount()
    vi.advanceTimersByTime(DEBOUNCE_MS * 2)

    expect(onViewportChange).not.toHaveBeenCalled()
  })

  it('5. два отдельных (не слипшихся по времени) жеста дают ДВА вызова', () => {
    vi.useFakeTimers()
    const map = new FakeMap()
    const onViewportChange = vi.fn()

    renderHook(() => {
      useMapViewport({ map: asMapLibreMap(map), onViewportChange, debounceMs: DEBOUNCE_MS })
    })

    map.fire('moveend')
    vi.advanceTimersByTime(DEBOUNCE_MS)
    map.fire('moveend')
    vi.advanceTimersByTime(DEBOUNCE_MS)

    expect(onViewportChange).toHaveBeenCalledTimes(2)
  })

  it('6. unmount без единого события — cleanup не падает (нет отложенного таймера)', () => {
    vi.useFakeTimers()
    const map = new FakeMap()
    const onViewportChange = vi.fn()

    const { unmount } = renderHook(() => {
      useMapViewport({ map: asMapLibreMap(map), onViewportChange, debounceMs: DEBOUNCE_MS })
    })

    expect(() => {
      unmount()
    }).not.toThrow()
    expect(onViewportChange).not.toHaveBeenCalled()
  })
})
