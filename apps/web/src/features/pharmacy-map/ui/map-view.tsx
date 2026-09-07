import { useMemo, useState, type ReactElement } from 'react'
import type { BboxCoordinates } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { MapView as UiMapView, type BBox, type MapPoint } from '@dorutj/ui'
// CSS карты — импорт потребителем, не `packages/ui` (DTJ-431, «Отдельный пункт: CSS карты», см.
// JSDoc ниже, пункт про CSS).
import 'maplibre-gl/dist/maplibre-gl.css'
import { useLocale } from '@/shared/config/locale-provider'
import type { MapPin } from '../model/map-pin'
import { PharmacyPinPopup } from './pharmacy-pin-popup'

export type { MapPin } from '../model/map-pin'

/**
 * `map-view.tsx` (DTJ-198/431, `SRS-CAT-053`).
 *
 * DTJ-431: тонкая обёртка над `MapView` (`@dorutj/ui`, DTJ-409) вместо самостоятельной реализации
 * поверх `maplibre-gl` — маппит доменные `MapPin` (`@dorutj/contracts`) на нейтральные `MapPoint`
 * общего компонента и обратно. Известные расхождения (зафиксированы постановкой тикета, отчёт
 * сдачи раздел «Известные расхождения»):
 *
 * 1. **Пины/попап.** Локальная версия рисовала `Marker`+`Popup` (React-портал в DOM-узел
 *    maplibre-gl) — общий `MapView` рендерит точки через GeoJSON-источник со встроенной
 *    кластеризацией (`use-map-markers.ts`, `packages/ui`) и отдаёт только `onSelect(pointId)`.
 *    Содержимое попапа (`PharmacyPinPopup`) переехало в СОБСТВЕННУЮ карточку этого файла,
 *    открываемую по `onSelect` (см. `selectedPin` ниже) — не floating popup у пина (у общего
 *    `MapView` нет доступа к экземпляру карты наружу для позиционирования), а закреплённая
 *    панель снизу карты. Кластеризация — ОСОЗНАННОЕ изменение UX (`SRS-CAT-053`): на малом зуме
 *    близкие пины сливаются в кружок с числом, разворачиваются кликом (zoom-to-expansion,
 *    `use-map-markers.ts`) — раньше каждый пин был отдельным маркером всегда.
 * 2. **URL тайлов.** Локальная версия сама читала `import.meta.env.VITE_TILESERVER_URL` — общий
 *    компонент принимает `styleUrl` пропом и в `env` не лезет (по заданию тикета DTJ-409,
 *    домен-агностичность). Чтение `env` осталось здесь, на границе фичи.
 * 3. **`onViewportChange`/`minZoom`.** Локальная версия имела оба (нужны экрану `/map`, DTJ-199) —
 *    общий `MapView` их не нёс. Добавлены В `packages/ui/src/components/map-view/map-view.tsx`
 *    ЭТИМ тикетом (прямо разрешено постановкой DTJ-431) — `BBox` (`@dorutj/ui`) структурно
 *    идентичен `BboxCoordinates` (`@dorutj/contracts`), проброс без маппинга полей.
 *
 * CSS: `maplibre-gl/dist/maplibre-gl.css` импортируется ЗДЕСЬ, потребителем (DTJ-431, «Отдельный
 * пункт: CSS карты») — `packages/ui` его больше не тянет в свой library-bundle (Vite в
 * library-mode не делит CSS по чанкам динамических импортов, раздувало `dist/ui.css` на ~70 КБ на
 * КАЖДОМ экране приложения, включая экраны без карты; см. отчёт сдачи, числа до/после).
 */

export interface MapViewProps {
  readonly center: { readonly lon: number; readonly lat: number }
  readonly zoom: number
  readonly minZoom?: number
  readonly pins: readonly MapPin[]
  readonly onViewportChange?: (bbox: BboxCoordinates) => void
  readonly onPinClick?: (pharmacyId: string) => void
}

function readTileServerStyleUrl(): string | undefined {
  const value = import.meta.env.VITE_TILESERVER_URL
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pinToPoint(pin: MapPin): MapPoint {
  return { id: pin.pharmacyId, lat: pin.lat, lng: pin.lon, label: pin.name }
}

/** `BBox` (`@dorutj/ui`) и `BboxCoordinates` (`@dorutj/contracts`) — одинаковые 4 поля
 * (`lonMin`/`latMin`/`lonMax`/`latMax`), см. JSDoc файла п.3. Явная функция вместо `as`-каста —
 * ловит расхождение форм на этапе компиляции, если один из типов когда-нибудь разойдётся. */
function toBboxCoordinates(bbox: BBox): BboxCoordinates {
  return { lonMin: bbox.lonMin, latMin: bbox.latMin, lonMax: bbox.lonMax, latMax: bbox.latMax }
}

export const MapView = ({ center, zoom, minZoom, pins, onViewportChange, onPinClick }: MapViewProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string | null>(null)

  const points = useMemo(() => pins.map(pinToPoint), [pins])
  const selectedPin = pins.find((pin) => pin.pharmacyId === selectedPharmacyId) ?? null
  const styleUrl = readTileServerStyleUrl()

  if (styleUrl === undefined) {
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

  const handleSelect = (pointId: string): void => {
    setSelectedPharmacyId(pointId)
    onPinClick?.(pointId)
  }

  const handleViewportChange = (bbox: BBox): void => {
    onViewportChange?.(toBboxCoordinates(bbox))
  }

  return (
    <div className="relative h-full w-full">
      <UiMapView
        points={points}
        center={{ lat: center.lat, lng: center.lon }}
        zoom={zoom}
        {...(minZoom !== undefined ? { minZoom } : {})}
        mode="full"
        styleUrl={styleUrl}
        onSelect={handleSelect}
        onViewportChange={handleViewportChange}
        className="h-full w-full"
      />
      {selectedPin !== null ? (
        <div className="absolute inset-x-2 bottom-2" data-testid="map-view-selected-pin-panel">
          <PharmacyPinPopup pin={selectedPin} />
        </div>
      ) : null}
    </div>
  )
}
