import { useEffect, useRef } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import type { MapPoint } from './types'

// Синхронизирует `points` с GeoJSON-источником MapLibre (cluster: true — встроенная кластеризация).
// Источник/слои создаются один раз на identity `map`; смена `points` — только `source.setData()`.

const SOURCE_ID = 'dorutj-map-view-points'
const CLUSTER_LAYER_ID = 'dorutj-map-view-clusters'
const CLUSTER_COUNT_LAYER_ID = 'dorutj-map-view-cluster-count'
const POINT_LAYER_ID = 'dorutj-map-view-unclustered-point'

const CLUSTER_CIRCLE_RADIUS_PX = 18
const CLUSTER_COUNT_FONT_SIZE_PX = 12
const POINT_CIRCLE_RADIUS_PX = 8
const POINT_STROKE_WIDTH_PX = 2

const FALLBACK_PRIMARY_COLOR = '#64748b'
const FALLBACK_SURFACE_COLOR = '#ffffff'

// Структурная копия среза GeoJSON FeatureCollection<Point> — ambient-неймспейс GeoJSON недоступен
// в этом tsconfig, но форма совпадает с тем, что реально ждёт addSource/setData.
interface PointFeature {
  readonly type: 'Feature'
  readonly properties: { readonly id: string; readonly label: string | null }
  readonly geometry: { readonly type: 'Point'; readonly coordinates: readonly [number, number] }
}
interface PointFeatureCollection {
  readonly type: 'FeatureCollection'
  readonly features: readonly PointFeature[]
}

// GL paint-выражения не понимают var(--brand-*) — резолвим токен в конкретное значение сами
function resolveCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.length > 0 ? value : fallback
}

function pointsToFeatureCollection(points: readonly MapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      properties: { id: point.id, label: point.label ?? null },
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    })),
  }
}

export interface UseMapMarkersOptions {
  readonly map: MapLibreGL.Map | null
  readonly points: readonly MapPoint[]
  readonly onSelect?: ((pointId: string) => void) | undefined
}

interface SetupLayersArgs {
  readonly map: MapLibreGL.Map
  readonly onSelectRef: { current: ((pointId: string) => void) | undefined }
}

function addClusterLayers(map: MapLibreGL.Map, primaryColor: string, surfaceColor: string): void {
  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: { 'circle-color': primaryColor, 'circle-radius': CLUSTER_CIRCLE_RADIUS_PX },
  })
  map.addLayer({
    id: CLUSTER_COUNT_LAYER_ID,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': CLUSTER_COUNT_FONT_SIZE_PX },
    paint: { 'text-color': surfaceColor },
  })
}

function addPointLayer(map: MapLibreGL.Map, primaryColor: string, surfaceColor: string): void {
  map.addLayer({
    id: POINT_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': primaryColor,
      'circle-radius': POINT_CIRCLE_RADIUS_PX,
      'circle-stroke-width': POINT_STROKE_WIDTH_PX,
      'circle-stroke-color': surfaceColor,
    },
  })
}

function setupLayers({ map, onSelectRef }: SetupLayersArgs): () => void {
  const primaryColor = resolveCssVar('--brand-primary', FALLBACK_PRIMARY_COLOR)
  const surfaceColor = resolveCssVar('--brand-surface', FALLBACK_SURFACE_COLOR)

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: pointsToFeatureCollection([]),
    cluster: true,
  })
  addClusterLayers(map, primaryColor, surfaceColor)
  addPointLayer(map, primaryColor, surfaceColor)

  const handlePointClick = (event: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.MapGeoJSONFeature[] }): void => {
    const feature = event.features?.[0]
    const pointId: unknown = feature?.properties.id
    if (typeof pointId === 'string') {
      onSelectRef.current?.(pointId)
    }
  }
  const canvas = map.getCanvas()
  const setPointerCursor = (): void => {
    canvas.style.cursor = 'pointer'
  }
  const resetCursor = (): void => {
    canvas.style.cursor = ''
  }

  map.on('click', POINT_LAYER_ID, handlePointClick)
  map.on('mouseenter', POINT_LAYER_ID, setPointerCursor)
  map.on('mouseleave', POINT_LAYER_ID, resetCursor)

  return () => {
    map.off('click', POINT_LAYER_ID, handlePointClick)
    map.off('mouseenter', POINT_LAYER_ID, setPointerCursor)
    map.off('mouseleave', POINT_LAYER_ID, resetCursor)
    if (map.getLayer(CLUSTER_COUNT_LAYER_ID) !== undefined) {
      map.removeLayer(CLUSTER_COUNT_LAYER_ID)
    }
    if (map.getLayer(CLUSTER_LAYER_ID) !== undefined) {
      map.removeLayer(CLUSTER_LAYER_ID)
    }
    if (map.getLayer(POINT_LAYER_ID) !== undefined) {
      map.removeLayer(POINT_LAYER_ID)
    }
    if (map.getSource(SOURCE_ID) !== undefined) {
      map.removeSource(SOURCE_ID)
    }
  }
}

export function useMapMarkers({ map, points, onSelect }: UseMapMarkersOptions): void {
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (map === null) {
      return undefined
    }
    return setupLayers({ map, onSelectRef })
  }, [map])

  useEffect(() => {
    if (map === null) {
      return
    }
    const source = map.getSource<MapLibreGL.GeoJSONSource>(SOURCE_ID)
    source?.setData(pointsToFeatureCollection(points))
  }, [map, points])
}
