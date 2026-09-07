import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { cx } from '../shared/cx.js'
import { useMapMarkers } from './use-map-markers.js'
import { useMapViewportChange } from './use-map-viewport-change.js'
import './map-view.css'

/**
 * `MapView` (DTJ-409, `SRS-UX-021`/`SRS-UX-034`/`SRS-UX-038`) — обёртка `MapLibre GL JS`,
 * домен-агностичная (не знает про «аптеку»/«заказ» — принимает нейтральные `MapPoint[]`,
 * маппинг доменных данных на точки делает фича-потребитель, EP-08). Тот же API пропсов задуман
 * переносимым на `flutter_map` в R2 (`SRS-UX-021`), поэтому колбэк называется `onSelect`, не
 * `onClick`/`onPinClick`.
 *
 * `MapLibre GL JS` грузится ЛЕНИВО — динамический `import()` внутри `useEffect`, который
 * исполняется только когда `MapView` реально смонтирован в DOM (`SRS-UX-038`). Модуль остаётся
 * `external` в сборке `vite.config.ts` (см. отчёт сдачи DTJ-409) — не попадает в основной бандл
 * `packages/ui` физически, только в отдельный чанк, запрашиваемый по требованию.
 *
 * **`maplibre-gl/dist/maplibre-gl.css` НЕ импортируется этим файлом (DTJ-431).** Vite в
 * library-mode не делит CSS по чанкам динамических импортов — весь CSS, до которого дотягивается
 * граф модулей (включая CSS библиотеки карт из динамического `import()` внутри `useEffect`),
 * линковался в ОДИН общий `dist/ui.css`, раздувая его с ~24 КБ до ~101 КБ (см. отчёт сдачи
 * DTJ-431: числа до/после) — на КАЖДОМ экране, даже там, где `MapView` не используется. Импорт
 * CSS карты — обязанность потребителя (`apps/web`, там же, где `MapView` реально используется),
 * рядом с `import('maplibre-gl')` в своей ленивой обёртке, ЛИБО статически в `main.tsx`, если
 * карта нужна на нескольких экранах сразу.
 *
 * **`onViewportChange`/`minZoom` (DTJ-431, известное расхождение API).** Локальный `MapView`
 * `apps/web` (DTJ-198) нёс оба — `onViewportChange` нужен экрану `/map` (запрос пинов по видимой
 * области, `use-map-viewport.ts`), `minZoom` — ограничение отдаления. Общий `MapView` (DTJ-409) их
 * не нёс. Добавлены сюда этим тикетом (см. `use-map-viewport-change.ts`, портирован из
 * `apps/web` почти без изменений) — правка `packages/ui` для этого прямо разрешена постановкой
 * DTJ-431.
 */

export type { GeoPoint, BBox, MapPoint, MapViewMode } from './map-view-types.js'
import type { BBox, GeoPoint, MapPoint, MapViewMode } from './map-view-types.js'

export interface MapViewProps {
  readonly points: readonly MapPoint[]
  readonly center?: GeoPoint
  readonly zoom?: number
  /** Ограничение минимального зума (отдаления) — прокидывается как есть в `maplibregl.Map`. */
  readonly minZoom?: number
  readonly bbox?: BBox
  readonly onSelect?: (pointId: string) => void
  /** Видимая область карты (`moveend`/`zoomend`, debounce `viewportDebounceMs`) — см. JSDoc файла
   * и `use-map-viewport-change.ts` (DTJ-431). */
  readonly onViewportChange?: (bbox: BBox) => void
  readonly viewportDebounceMs?: number
  /** `preview` — 150-190px карточка (превью на товаре/чекауте), `full` — полноэкранный `/map`
   * (`32-design-reference.md` расхождение №7). */
  readonly mode: MapViewMode
  /** Композиция потребителя (`EmptyState` из DTJ-406) — `MapView` сам не хардкодит текст пустого
   * состояния. Рендерится ВМЕСТО карты, когда `points` пуст И этот слот передан — задача 6 тикета. */
  readonly emptyStateSlot?: ReactNode
  /** Стиль тайлов MapLibre (`StyleSpecification` или URL `.json`). По умолчанию — публичные растровые
   * тайлы OSM без ключа (`01-TECH-BASELINE.md`: «без проприетарных SDK и API-ключей»). Тенант/фича
   * с self-hosted tileserver'ом передаёт свой (см. «Расхождения» в отчёте — `apps/web` DTJ-198 уже
   * использует `VITE_TILESERVER_URL`). */
  readonly styleUrl?: string | StyleSpecification
  /** Зовётся один раз, когда карта не смогла загрузиться (сбой инициализации `MapLibre GL`,
   * ошибка тайлов/сети — то же событие, что показывает внутренний `data-testid="map-view-load-error"`).
   * `MapView` сам не знает локализованного текста ошибки (домен-агностичность, см. JSDoc файла) —
   * колбэк даёт потребителю показать СВОЁ сообщение (например поверх карты), не дублируя логику
   * определения сбоя (DTJ-431, задача «понятный текст при реальной ошибке загрузки»). */
  readonly onLoadError?: () => void
  readonly className?: string
}

const DEFAULT_ZOOM = 12
/** Нейтральный fallback-центр/зум, когда не переданы ни `center`, ни `bbox`, ни `points` —
 * компонент не «падает», просто открывает вид на весь мир (ASSUMPTION, п. Риски тикета: реальный
 * дефолт-центр — забота потребителя, у `MapView` нет знаний о географии продукта). */
const FALLBACK_CENTER: GeoPoint = { lat: 0, lng: 0 }
const FALLBACK_ZOOM = 1

const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
const DEFAULT_OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: OSM_ATTRIBUTION,
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
}

async function loadMapLibreGl(): Promise<typeof MapLibreGL> {
  // CSS больше НЕ импортируется здесь (DTJ-431) — см. JSDoc файла "maplibre-gl.css НЕ импортируется".
  return import('maplibre-gl')
}

function computeInitialCenter(center: GeoPoint | undefined, points: readonly MapPoint[]): GeoPoint {
  if (center !== undefined) {
    return center
  }
  if (points.length > 0) {
    const sum = points.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), {
      lat: 0,
      lng: 0,
    })
    return { lat: sum.lat / points.length, lng: sum.lng / points.length }
  }
  return FALLBACK_CENTER
}

interface CreateMapArgs {
  readonly maplibregl: typeof MapLibreGL
  readonly container: HTMLDivElement
  readonly styleUrl: string | StyleSpecification
  readonly initialCenter: GeoPoint
  readonly initialZoom: number
  readonly minZoom: number | undefined
  readonly bbox: BBox | undefined
  readonly mode: MapViewMode
}

function createMap({ maplibregl, container, styleUrl, initialCenter, initialZoom, minZoom, bbox, mode }: CreateMapArgs): MapLibreMap {
  const map = new maplibregl.Map({
    container,
    style: styleUrl,
    center: [initialCenter.lng, initialCenter.lat],
    zoom: initialZoom,
    attributionControl: false,
    ...(minZoom !== undefined ? { minZoom } : {}),
  })

  if (bbox !== undefined) {
    map.fitBounds(
      [
        [bbox.lonMin, bbox.latMin],
        [bbox.lonMax, bbox.latMax],
      ],
      { animate: false },
    )
  }

  // `preview` — карта используется как статичная иллюстрация внутри скроллящейся страницы
  // (карточка товара/чекаут): scroll-зум карты не должен перехватывать скролл страницы.
  if (mode === 'preview') {
    map.scrollZoom.disable()
  }

  return map
}

/** `MapView` рендерит `emptyStateSlot` вместо монтирования карты, когда точек нет и слот передан
 * (критерий приёмки 1) — экономит и лишний DOM, и ленивую загрузку `MapLibre GL`, которая иначе
 * стартовала бы ради пустого вида. */
function shouldRenderEmptyState(points: readonly MapPoint[], emptyStateSlot: ReactNode | undefined): boolean {
  return points.length === 0 && emptyStateSlot !== undefined
}

export const MapView = ({
  points,
  center,
  zoom,
  minZoom,
  bbox,
  onSelect,
  onViewportChange,
  viewportDebounceMs,
  mode,
  emptyStateSlot,
  styleUrl,
  onLoadError,
  className,
}: MapViewProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [readyMap, setReadyMap] = useState<MapLibreMap | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const isEmpty = shouldRenderEmptyState(points, emptyStateSlot)
  // Захватывается один раз при монтировании эффекта — смена `points`/`center`/`zoom`/`bbox` уже
  // ПОСЛЕ инициализации карты идёт через `useMapMarkers`/панорамирование пользователя, не через
  // пересоздание карты (см. use-map-markers.ts JSDoc).
  const initialViewRef = useRef({ center, zoom, minZoom, bbox, points })

  useEffect(() => {
    if (isEmpty) {
      return undefined
    }
    const container = containerRef.current
    if (container === null) {
      return undefined
    }

    let cancelled = false

    loadMapLibreGl()
      .then((maplibregl) => {
        if (cancelled || containerRef.current === null) {
          return
        }
        const initial = initialViewRef.current
        const map = createMap({
          maplibregl,
          container: containerRef.current,
          styleUrl: styleUrl ?? DEFAULT_OSM_STYLE,
          initialCenter: computeInitialCenter(initial.center, initial.points),
          initialZoom: initial.zoom ?? (initial.bbox !== undefined ? DEFAULT_ZOOM : FALLBACK_ZOOM),
          minZoom: initial.minZoom,
          bbox: initial.bbox,
          mode,
        })
        map.on('load', () => {
          if (!cancelled) {
            mapRef.current = map
            setReadyMap(map)
          }
        })
        map.on('error', () => {
          if (!cancelled && mapRef.current === null) {
            setLoadFailed(true)
            onLoadError?.()
          }
        })
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true)
          onLoadError?.()
        }
      })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      setReadyMap(null)
    }
    // Зависимости намеренно ограничены [isEmpty, styleUrl] — начальный вид карты
    // (center/zoom/bbox/points) читается один раз из initialViewRef (см. комментарий выше), не из
    // замыкания; react-hooks/exhaustive-deps в этом проекте не подключён (см. eslint.config.mjs),
    // поэтому явного disable-комментария для него не требуется.
  }, [isEmpty, styleUrl])

  useMapMarkers({ map: readyMap, points, onSelect })
  useMapViewportChange({ map: readyMap, onViewportChange, debounceMs: viewportDebounceMs })

  const containerClassName = cx('ui-map-view', mode === 'preview' && 'ui-map-view--preview', className)

  if (isEmpty) {
    return (
      <div className={containerClassName} data-testid="map-view-empty">
        {emptyStateSlot}
      </div>
    )
  }

  return (
    <div className={containerClassName} data-testid="map-view-canvas-wrapper">
      <div ref={containerRef} className="ui-map-view__canvas" data-testid="map-view-canvas" />
      {loadFailed ? <div className="ui-map-view__load-error" role="status" data-testid="map-view-load-error" /> : null}
    </div>
  )
}
