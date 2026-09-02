import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type * as MapLibreGL from 'maplibre-gl'
import type { BboxCoordinates } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { LocaleProvider, useLocale } from '@/shared/config/locale-provider'
import { useMapViewport } from '../model/use-map-viewport'
import type { MapPin } from '../model/map-pin'
import { PharmacyPinPopup } from './pharmacy-pin-popup'

export type { MapPin } from '../model/map-pin'

/**
 * `map-view.tsx` (DTJ-198, `SRS-CAT-053`).
 *
 * Тонкая обёртка над `maplibre-gl` поверх self-hosted vector-tile источника (`REQ-GEO-1` запрещает
 * Yandex/Google — только self-hosted, `VITE_TILESERVER_URL`). Компонент не знает про HTTP: `bbox`
 * уходит наружу через `onViewportChange` (`use-map-viewport.ts`), сетевой вызов — забота
 * `features/pharmacy-map/api` (DTJ-199).
 *
 * ВРЕМЕННО реализован локально (не `packages/ui`) — EP-18 ещё не выпустил базовый `MapView` на
 * момент этого тикета (волна 6). Перенос — DTJ-200 (`tickets/ep05-search-map/DTJ-200.md`,
 * `SRS-UX-034`), карта используется минимум на 5 экранах (courier/home/checkout/order/`/map`).
 *
 * Перф (дешёвый Android, слабый интернет): `maplibre-gl` (JS+CSS) грузится ЛЕНИВО через
 * динамический `import()` внутри эффекта, а не статическим импортом — модуль не попадает в
 * основной бандл и не блокирует первую отрисовку остального интерфейса, пока `MapView` не
 * смонтирован в реальном viewport.
 */

export interface MapViewProps {
  readonly center: { readonly lon: number; readonly lat: number }
  readonly zoom: number
  readonly minZoom?: number
  readonly pins: readonly MapPin[]
  readonly onViewportChange?: (bbox: BboxCoordinates) => void
  readonly onPinClick?: (pharmacyId: string) => void
}

type MapStatus = 'loading' | 'ready' | 'unavailable'

const PIN_MARKER_COLOR = 'var(--color-brand-primary)'
const POPUP_OFFSET_PX = 24
const NOOP_VIEWPORT_CHANGE = (): void => undefined

function readTileServerStyleUrl(): string | undefined {
  const value = import.meta.env.VITE_TILESERVER_URL
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

async function loadMapLibre(): Promise<typeof MapLibreGL> {
  const [mapLibreModule] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ])
  return mapLibreModule
}

interface OpenPinPopupArgs {
  readonly map: MapLibreGL.Map
  readonly maplibregl: typeof MapLibreGL
  readonly pin: MapPin
}

function openPinPopup({ map, maplibregl, pin }: OpenPinPopupArgs): void {
  const container = document.createElement('div')
  const root = createRoot(container)
  // Попап монтируется в ОТДЕЛЬНОЕ React-дерево (createRoot на DOM-узле maplibre-gl, вне дерева
  // MapView) — контекст родителя (LocaleProvider) сюда не долетает. Регресс DTJ-198: без своего
  // LocaleProvider `useLocale()` внутри PharmacyPinPopup падал с "должен использоваться внутри
  // LocaleProvider". Персистентная локаль читается из того же localStorage, что и у родителя.
  root.render(
    <LocaleProvider>
      <PharmacyPinPopup pin={pin} />
    </LocaleProvider>,
  )

  const popup = new maplibregl.Popup({ offset: POPUP_OFFSET_PX })
    .setLngLat([pin.lon, pin.lat])
    .setDOMContent(container)
    .addTo(map)

  popup.on('close', () => {
    root.unmount()
  })
}

interface CreatePinMarkerArgs {
  readonly map: MapLibreGL.Map
  readonly maplibregl: typeof MapLibreGL
  readonly pin: MapPin
  readonly onPinClick?: ((pharmacyId: string) => void) | undefined
}

function createPinMarker({ map, maplibregl, pin, onPinClick }: CreatePinMarkerArgs): MapLibreGL.Marker {
  const marker = new maplibregl.Marker({ color: PIN_MARKER_COLOR }).setLngLat([pin.lon, pin.lat]).addTo(map)

  marker.getElement().addEventListener('click', () => {
    onPinClick?.(pin.pharmacyId)
    openPinPopup({ map, maplibregl, pin })
  })

  return marker
}

export const MapView = ({ center, zoom, minZoom, pins, onViewportChange, onPinClick }: MapViewProps): ReactElement => {
  const { t } = useT(useLocale().locale)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const mapLibreModuleRef = useRef<typeof MapLibreGL | null>(null)
  const initialViewRef = useRef({ center, zoom })
  const [status, setStatus] = useState<MapStatus>('loading')
  const [readyMap, setReadyMap] = useState<MapLibreGL.Map | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const styleUrl = readTileServerStyleUrl()
    if (container === null || styleUrl === undefined) {
      setStatus('unavailable')
      return undefined
    }

    let cancelled = false
    let hasLoadedOnce = false

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled) {
          return
        }
        mapLibreModuleRef.current = maplibregl
        const { center: initialCenter, zoom: initialZoom } = initialViewRef.current
        const map = new maplibregl.Map({
          container,
          style: styleUrl,
          center: [initialCenter.lon, initialCenter.lat],
          zoom: initialZoom,
          ...(minZoom !== undefined ? { minZoom } : {}),
        })
        map.on('load', () => {
          hasLoadedOnce = true
          if (!cancelled) {
            mapRef.current = map
            setReadyMap(map)
            setStatus('ready')
          }
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
      mapRef.current?.remove()
      mapRef.current = null
      setReadyMap(null)
    }
  }, [minZoom])

  useEffect(() => {
    const maplibregl = mapLibreModuleRef.current
    if (readyMap === null || maplibregl === null) {
      return undefined
    }
    const markers = pins.map((pin) => createPinMarker({ map: readyMap, maplibregl, pin, onPinClick }))
    return () => {
      markers.forEach((marker) => {
        marker.remove()
      })
    }
  }, [readyMap, pins, onPinClick])

  useMapViewport({ map: readyMap, onViewportChange: onViewportChange ?? NOOP_VIEWPORT_CHANGE })

  if (status === 'unavailable') {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-surface p-4 text-center text-sm text-ink-muted"
        role="status"
        data-testid="map-view-unavailable"
      >
        {t('map.unavailable')}
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full" data-testid="map-view-canvas" />
}
