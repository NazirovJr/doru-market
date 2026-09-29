import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import { useMapMarkers } from './use-map-markers'
import type { BBox, GeoPoint, MapPoint, MapViewMode } from './types'

export type { BBox, GeoPoint, MapPoint, MapViewMode } from './types'

/**
 * `MapView` — домен-агностичная обёртка `MapLibre GL JS`, ничего не знает о потребителе.
 * `tileStyleUrl` приходит пропом, а не из `import.meta.env`: пакет собирается отдельным `vite
 * build`, и без реального значения на этом шаге минификатор считает загрузку карты мёртвым
 * кодом и вырезает её из `dist`.
 */

export interface MapViewProps {
  readonly points: readonly MapPoint[]
  readonly center?: GeoPoint
  readonly zoom?: number
  readonly bbox?: BBox
  readonly onSelect?: (pointId: string) => void
  readonly mode: MapViewMode
  readonly tileStyleUrl?: string | undefined
  readonly emptyStateSlot?: ReactNode
  readonly unavailableSlot?: ReactNode
  readonly onViewportChange?: (bbox: BBox) => void
  readonly className?: string
}

type MapStatus = 'loading' | 'ready' | 'unavailable'

const DEFAULT_CENTER: GeoPoint = { lat: 0, lng: 0 }
const DEFAULT_ZOOM = 2
const DEFAULT_VIEWPORT_DEBOUNCE_MS = 400
const NOOP_VIEWPORT_CHANGE = (): void => undefined

// preview (карточка/чекаут) не должен перехватывать скролл/жесты страницы
const PREVIEW_INTERACTION_OPTIONS = {
  scrollZoom: false,
  dragPan: false,
  dragRotate: false,
  doubleClickZoom: false,
  touchZoomRotate: false,
  keyboard: false,
}

function normalizeStyleUrl(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined
}

async function loadMapLibre(): Promise<typeof MapLibreGL> {
  const [mapLibreModule] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
  return mapLibreModule
}

function bboxToBounds(bbox: BBox): MapLibreGL.LngLatBoundsLike {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.north],
  ]
}

function extractBbox(map: MapLibreGL.Map): BBox {
  const bounds = map.getBounds()
  return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }
}

interface InitialView {
  readonly mode: MapViewMode
  readonly center: GeoPoint
  readonly zoom: number
  readonly bbox: BBox | undefined
  readonly tileStyleUrl: string | undefined
}

function buildMapOptions(container: HTMLElement, styleUrl: string, view: InitialView): MapLibreGL.MapOptions {
  const viewport =
    view.bbox !== undefined
      ? { bounds: bboxToBounds(view.bbox) }
      : { center: [view.center.lng, view.center.lat] as [number, number], zoom: view.zoom }
  const interaction = view.mode === 'preview' ? PREVIEW_INTERACTION_OPTIONS : {}
  return { container, style: styleUrl, ...viewport, ...interaction }
}

function subscribeViewportChange(
  map: MapLibreGL.Map,
  onViewportChangeRef: { current: (bbox: BBox) => void },
): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const handleSettled = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      onViewportChangeRef.current(extractBbox(map))
    }, DEFAULT_VIEWPORT_DEBOUNCE_MS)
  }
  map.on('moveend', handleSettled)
  map.on('zoomend', handleSettled)
  return () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
    map.off('moveend', handleSettled)
    map.off('zoomend', handleSettled)
  }
}

export const MapView = ({
  points,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  bbox,
  onSelect,
  mode,
  tileStyleUrl,
  emptyStateSlot,
  unavailableSlot,
  onViewportChange,
  className,
}: MapViewProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const initialViewRef = useRef<InitialView>({ mode, center, zoom, bbox, tileStyleUrl })
  const onViewportChangeRef = useRef(onViewportChange ?? NOOP_VIEWPORT_CHANGE)
  onViewportChangeRef.current = onViewportChange ?? NOOP_VIEWPORT_CHANGE
  const [status, setStatus] = useState<MapStatus>('loading')
  const [readyMap, setReadyMap] = useState<MapLibreGL.Map | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const styleUrl = normalizeStyleUrl(initialViewRef.current.tileStyleUrl)
    if (container === null || styleUrl === undefined) {
      setStatus('unavailable')
      return undefined
    }

    let cancelled = false
    let hasLoadedOnce = false
    let unsubscribeViewport: (() => void) | undefined

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled) {
          return
        }
        const map = new maplibregl.Map(buildMapOptions(container, styleUrl, initialViewRef.current))
        map.on('load', () => {
          hasLoadedOnce = true
          if (cancelled) {
            return
          }
          mapRef.current = map
          unsubscribeViewport = subscribeViewportChange(map, onViewportChangeRef)
          setReadyMap(map)
          setStatus('ready')
        })
        map.on('error', () => {
          if (!hasLoadedOnce && !cancelled) {
            setStatus('unavailable')
          }
        })
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('unavailable')
        }
      })

    return () => {
      cancelled = true
      unsubscribeViewport?.()
      mapRef.current?.remove()
      mapRef.current = null
      setReadyMap(null)
    }
    // deps: [] — карта не пересоздаётся при смене пропсов родителя, стартовый вид берётся из initialViewRef
  }, [])

  useMapMarkers({ map: readyMap, points, onSelect })

  const isEmpty = points.length === 0

  return (
    <div className={className} style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div ref={containerRef} data-testid="map-view-canvas" style={{ height: '100%', width: '100%' }} />
      {status === 'unavailable' && unavailableSlot !== undefined ? (
        <div data-testid="map-view-unavailable-slot" style={{ position: 'absolute', inset: 0 }}>
          {unavailableSlot}
        </div>
      ) : null}
      {isEmpty && emptyStateSlot !== undefined ? (
        <div data-testid="map-view-empty-slot" style={{ position: 'absolute', inset: 0 }}>
          {emptyStateSlot}
        </div>
      ) : null}
    </div>
  )
}
