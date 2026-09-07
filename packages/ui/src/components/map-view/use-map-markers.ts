import { useEffect, useRef } from 'react'
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from 'maplibre-gl'
import type { MapPoint } from './map-view-types.js'

/**
 * `use-map-markers.ts` (DTJ-409, `SRS-UX-034`) — синхронизирует React-состояние `points` с
 * нативным MapLibre GL источником данных (GeoJSON + `cluster: true`, задача 2 тикета: "использовать
 * встроенную кластеризацию MapLibre GL, не реализовывать вручную").
 *
 * Источник/слои создаются РОВНО ОДИН раз на экземпляр карты (эффект зависит только от `map`).
 * Смена `points` бьёт исключительно в `GeoJSONSource.setData()` — карта и её слои не пересоздаются
 * (тест-план DTJ-409: "syncs added/removed points without full re-render of the map instance").
 */

export const MAP_POINTS_SOURCE_ID = 'ui-map-view-points'
export const MAP_CLUSTER_LAYER_ID = 'ui-map-view-clusters'
export const MAP_CLUSTER_COUNT_LAYER_ID = 'ui-map-view-cluster-count'
export const MAP_POINT_LAYER_ID = 'ui-map-view-unclustered-point'

/** Дефолты MapLibre GL для кластеризации (ASSUMPTION тикета DTJ-409 — калибровка под реальную
 * плотность аптек Душанбе появится позже, данные для неё будут только после seed EP-04/EP-08). */
const DEFAULT_CLUSTER_MAX_ZOOM = 14
const DEFAULT_CLUSTER_RADIUS = 50

/** Радиус круга кластера по количеству точек в нём (`circle-radius` step-выражение MapLibre) —
 * маленький кластер (<10 точек) 16px, средний (<25) 20px, крупный 24px. */
const CLUSTER_RADIUS_SMALL_PX = 16
const CLUSTER_RADIUS_MEDIUM_PX = 20
const CLUSTER_RADIUS_LARGE_PX = 24
const CLUSTER_SIZE_MEDIUM_THRESHOLD = 10
const CLUSTER_SIZE_LARGE_THRESHOLD = 25
const UNCLUSTERED_POINT_RADIUS_PX = 8
const UNCLUSTERED_POINT_STROKE_WIDTH_PX = 2
const CLUSTER_COUNT_TEXT_SIZE_PX = 12
/** Нейтральные дефолты токенов (`tokens/colors.css`) — на случай, когда CSS ещё не применён. */
const BRAND_PRIMARY_FALLBACK = '#64748b'
const BRAND_SURFACE_FALLBACK = '#ffffff'

export interface UseMapMarkersOptions {
  readonly map: MapLibreMap | null
  readonly points: readonly MapPoint[]
  readonly onSelect?: ((pointId: string) => void) | undefined
}

interface PointFeatureProperties {
  readonly id: string
  readonly label: string | null
}

/** Локальный минимальный GeoJSON-тип вместо ambient-неймспейса `GeoJSON` (`@types/geojson`) —
 * пакет не резолвится в этом монорепо (не hoisted, transitive-only зависимость самого
 * `maplibre-gl`), а ставить его отдельной зависимостью вне разрешения CTO по `maplibre-gl`
 * не входит в этот тикет (`AGENTS.md` §10 "нужен пакет, которого нет — не ставь"). Структурно
 * совместим с ожидаемым `GeoJSON.GeoJSON` в сигнатурах `maplibre-gl` (`addSource`/`setData`). */
interface PointFeatureCollection {
  readonly type: 'FeatureCollection'
  readonly features: readonly {
    readonly type: 'Feature'
    readonly geometry: { readonly type: 'Point'; readonly coordinates: readonly [number, number] }
    readonly properties: PointFeatureProperties
  }[]
}

function toFeatureCollection(points: readonly MapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] as const },
      properties: { id: point.id, label: point.label ?? null },
    })),
  }
}

/**
 * MapLibre GL НЕ резолвит CSS-переменные в paint-выражениях: `'circle-color': 'var(--brand-primary)'`
 * для него не цвет, а мусор, и `addLayer` в этом случае молча не добавляет слой — без исключения и
 * без записи в консоль. Внешне это выглядело как «карта грузится, а аптек на ней нет».
 *
 * Юнит-тесты пакета этого поймать не могли: они работают на фейковом `Map`, который paint не
 * валидирует. Найдено только на живой карте в браузере.
 *
 * Поэтому токен резолвится в реальный цвет ДО передачи в MapLibre. Значение читается с
 * `document.documentElement`, то есть White-Label продолжает работать: сеть, переопределившая
 * `--brand-primary`, получит свои цвета маркеров при следующем построении слоёв.
 */
function resolveBrandColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return value.length > 0 ? value : fallback
}

function addPointsSourceAndLayers(map: MapLibreMap, initialPoints: readonly MapPoint[]): void {
  const primaryColor = resolveBrandColor('--brand-primary', BRAND_PRIMARY_FALLBACK)
  const surfaceColor = resolveBrandColor('--brand-surface', BRAND_SURFACE_FALLBACK)

  if (map.getSource(MAP_POINTS_SOURCE_ID) !== undefined) {
    return
  }

  map.addSource(MAP_POINTS_SOURCE_ID, {
    type: 'geojson',
    data: toFeatureCollection(initialPoints),
    cluster: true,
    clusterMaxZoom: DEFAULT_CLUSTER_MAX_ZOOM,
    clusterRadius: DEFAULT_CLUSTER_RADIUS,
  })

  map.addLayer({
    id: MAP_CLUSTER_LAYER_ID,
    type: 'circle',
    source: MAP_POINTS_SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': primaryColor,
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        CLUSTER_RADIUS_SMALL_PX,
        CLUSTER_SIZE_MEDIUM_THRESHOLD,
        CLUSTER_RADIUS_MEDIUM_PX,
        CLUSTER_SIZE_LARGE_THRESHOLD,
        CLUSTER_RADIUS_LARGE_PX,
      ],
    },
  })

  map.addLayer({
    id: MAP_CLUSTER_COUNT_LAYER_ID,
    type: 'symbol',
    source: MAP_POINTS_SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': CLUSTER_COUNT_TEXT_SIZE_PX },
    paint: { 'text-color': surfaceColor },
  })

  map.addLayer({
    id: MAP_POINT_LAYER_ID,
    type: 'circle',
    source: MAP_POINTS_SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': primaryColor,
      'circle-radius': UNCLUSTERED_POINT_RADIUS_PX,
      'circle-stroke-width': UNCLUSTERED_POINT_STROKE_WIDTH_PX,
      'circle-stroke-color': surfaceColor,
    },
  })
}

/** Клик по кластеру — приближает карту до зума, на котором кластер распадается (стандартное
 * поведение MapLibre-кластеров, `getClusterExpansionZoom`, Promise-based API в `maplibre-gl@5`),
 * не вызывает `onSelect` (кластер — не точка). */
/** `MapGeoJSONFeature.geometry` типизирован через ambient-неймспейс `GeoJSON` (`@types/geojson`),
 * не резолвящийся в этом монорепо (см. JSDoc `PointFeatureCollection` выше) — библиотечный тип
 * этого поля деградирует до нерезолвящегося `error`-типа, `no-unsafe-*` не проходит на прямом
 * обращении к нему. Кластерные фичи — всегда точки (source сконфигурирован без линий/полигонов),
 * локальный тип ниже описывает ровно то, что реально нужно (`type`/`coordinates`). */
interface ClusterFeatureLike {
  readonly properties: { readonly cluster_id?: number }
  readonly geometry: { readonly type: string; readonly coordinates: [number, number] }
}

function handleClusterClick(map: MapLibreMap, event: MapLayerMouseEvent): void {
  const feature = map.queryRenderedFeatures(event.point, { layers: [MAP_CLUSTER_LAYER_ID] })[0] as
    | ClusterFeatureLike
    | undefined
  const clusterId = feature?.properties.cluster_id
  const source = map.getSource<GeoJSONSource>(MAP_POINTS_SOURCE_ID)
  const geometry = feature?.geometry
  if (clusterId === undefined || source === undefined || geometry?.type !== 'Point') {
    return
  }

  const coordinates = geometry.coordinates
  source
    .getClusterExpansionZoom(clusterId)
    .then((expansionZoom) => {
      map.easeTo({ center: coordinates, zoom: expansionZoom })
    })
    .catch(() => undefined)
}

function handlePointClick(event: MapLayerMouseEvent, onSelectRef: { current: ((pointId: string) => void) | undefined }): void {
  const pointId = event.features?.[0]?.properties.id as string | undefined
  if (pointId !== undefined) {
    onSelectRef.current?.(pointId)
  }
}

export function useMapMarkers({ map, points, onSelect }: UseMapMarkersOptions): void {
  const pointsAtSetupRef = useRef(points)
  pointsAtSetupRef.current = points
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (map === null) {
      return undefined
    }

    addPointsSourceAndLayers(map, pointsAtSetupRef.current)

    const onCluster = (event: MapLayerMouseEvent): void => { handleClusterClick(map, event); }
    const onPoint = (event: MapLayerMouseEvent): void => { handlePointClick(event, onSelectRef); }

    map.on('click', MAP_CLUSTER_LAYER_ID, onCluster)
    map.on('click', MAP_POINT_LAYER_ID, onPoint)

    return () => {
      map.off('click', MAP_CLUSTER_LAYER_ID, onCluster)
      map.off('click', MAP_POINT_LAYER_ID, onPoint)
    }
  }, [map])

  useEffect(() => {
    if (map === null) {
      return
    }
    const source = map.getSource<GeoJSONSource>(MAP_POINTS_SOURCE_ID)
    source?.setData(toFeatureCollection(points))
  }, [map, points])
}
