import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { BBox } from './map-view-types.js'

/**
 * `use-map-viewport-change.ts` (DTJ-431) — известное расхождение API `MapView`, зафиксированное
 * тикетом DTJ-431 (`apps/web` уже имел `onViewportChange` в локальном `MapView`, DTJ-198, нужен
 * экрану `/map` для запроса пинов по видимой области; общий `MapView`, DTJ-409, его не нёс).
 * Портировано из `apps/web/src/features/pharmacy-map/model/use-map-viewport.ts` почти без
 * изменений — тот же приём (`moveend`/`zoomend` → debounce → один вызов колбэка с `BBox`).
 *
 * Не сетевой хук — только геометрия карты, ответственность за запрос по новому `bbox` остаётся у
 * потребителя (тот же принцип, что и раньше).
 */

const DEFAULT_VIEWPORT_DEBOUNCE_MS = 400

export interface UseMapViewportChangeOptions {
  readonly map: MapLibreMap | null
  readonly onViewportChange?: ((bbox: BBox) => void) | undefined
  readonly debounceMs?: number | undefined
}

function extractBbox(map: MapLibreMap): BBox {
  const bounds = map.getBounds()
  return {
    lonMin: bounds.getWest(),
    latMin: bounds.getSouth(),
    lonMax: bounds.getEast(),
    latMax: bounds.getNorth(),
  }
}

export function useMapViewportChange({
  map,
  onViewportChange,
  debounceMs = DEFAULT_VIEWPORT_DEBOUNCE_MS,
}: UseMapViewportChangeOptions): void {
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange

  useEffect(() => {
    if (map === null || onViewportChangeRef.current === undefined) {
      return undefined
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const handleViewportSettled = (): void => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        onViewportChangeRef.current?.(extractBbox(map))
      }, debounceMs)
    }

    map.on('moveend', handleViewportSettled)
    map.on('zoomend', handleViewportSettled)

    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      map.off('moveend', handleViewportSettled)
      map.off('zoomend', handleViewportSettled)
    }
  }, [map, debounceMs])
}
