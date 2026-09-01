import { useEffect, useRef } from 'react'
import type { BboxCoordinates } from '@dorutj/contracts'
import type { Map as MapLibreMap } from 'maplibre-gl'

/**
 * `use-map-viewport.ts` (DTJ-198, SRS-CAT-053).
 *
 * Извлекает `bbox` видимой области карты по `moveend`/`zoomend` и передаёт его наружу через
 * `onViewportChange`. Debounce схлопывает серию событий одного жеста (инерция панорамирования,
 * `zoomend`+`moveend` подряд) в РОВНО ОДИН вызов (критерий приёмки 3).
 *
 * Намеренно НЕ делает сетевой вызов — только геометрия карты (`02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §5: `api`/`model`/`ui` разделены). Запрос пинов по новому `bbox` — ответственность
 * `features/pharmacy-map/api` (DTJ-199).
 */

const DEFAULT_VIEWPORT_DEBOUNCE_MS = 400

export interface UseMapViewportOptions {
  readonly map: MapLibreMap | null
  readonly onViewportChange: (bbox: BboxCoordinates) => void
  readonly debounceMs?: number
}

function extractBbox(map: MapLibreMap): BboxCoordinates {
  const bounds = map.getBounds()
  return {
    lonMin: bounds.getWest(),
    latMin: bounds.getSouth(),
    lonMax: bounds.getEast(),
    latMax: bounds.getNorth(),
  }
}

export function useMapViewport({
  map,
  onViewportChange,
  debounceMs = DEFAULT_VIEWPORT_DEBOUNCE_MS,
}: UseMapViewportOptions): void {
  // Ref держит актуальный колбэк без пересоздания подписки на каждый рендер родителя
  // (наивный вариант с `onViewportChange` в deps эффекта переустанавливал бы listeners
  // при каждом ре-рендере MapView).
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange

  useEffect(() => {
    if (map === null) {
      return undefined
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const handleViewportSettled = (): void => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      timeoutId = setTimeout(() => {
        onViewportChangeRef.current(extractBbox(map))
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
