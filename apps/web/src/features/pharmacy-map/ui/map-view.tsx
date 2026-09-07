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
 *    домен-агностичность). Чтение `env` осталось здесь, на границе фичи. Когда переменная пуста —
 *    `styleUrl` пробрасывается как `undefined`, и `MapView` (`@dorutj/ui`) сам подставляет свой
 *    встроенный OSM-фолбэк (`DEFAULT_OSM_STYLE`, `packages/ui/src/components/map-view/map-view.tsx`,
 *    растровые тайлы `tile.openstreetmap.org`, без ключей — `01-TECH-BASELINE.md`). Раньше (DTJ-198)
 *    пустой `VITE_TILESERVER_URL` был ранним выходом в заглушку «карта недоступна» БЕЗ монтирования
 *    `MapView` — на момент того тикета у общего компонента не было запасного стиля. Сейчас есть,
 *    и этот файл больше не блокирует попытку показать карту только из-за отсутствия tileserver'а
 *    тенанта (см. п.4 ниже про заглушку недоступности).
 * 3. **`onViewportChange`/`minZoom`.** Локальная версия имела оба (нужны экрану `/map`, DTJ-199) —
 *    общий `MapView` их не нёс. Добавлены В `packages/ui/src/components/map-view/map-view.tsx`
 *    ЭТИМ тикетом (прямо разрешено постановкой DTJ-431) — `BBox` (`@dorutj/ui`) структурно
 *    идентичен `BboxCoordinates` (`@dorutj/contracts`), проброс без маппинга полей.
 * 4. **Заглушка «карта недоступна».** Больше не показывается вместо ПОПЫТКИ загрузить карту —
 *    только когда карта РЕАЛЬНО не смогла загрузиться (сбой инициализации `MapLibre GL`,
 *    недоступны тайлы/сеть). `MapView` (`@dorutj/ui`) сообщает об этом через `onLoadError`
 *    (добавлен в `packages/ui` этим тикетом, см. JSDoc там) — обёртка держит локальный флаг
 *    `loadError` и рендерит `t('map.unavailable')` ПОВЕРХ карты (`data-testid="map-view-unavailable"`),
 *    не вместо неё: контейнер карты остаётся смонтирован (внутренний индикатор `MapView`
 *    `data-testid="map-view-load-error"` тоже остаётся в DOM, он для случаев без локализованного
 *    оверлея потребителя).
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
  const [loadError, setLoadError] = useState(false)

  const points = useMemo(() => pins.map(pinToPoint), [pins])
  const selectedPin = pins.find((pin) => pin.pharmacyId === selectedPharmacyId) ?? null
  const styleUrl = readTileServerStyleUrl()

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
        {...(styleUrl !== undefined ? { styleUrl } : {})}
        onSelect={handleSelect}
        onViewportChange={handleViewportChange}
        onLoadError={() => {
          setLoadError(true)
        }}
        className="h-full w-full"
      />
      {loadError ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-surface p-4 text-center text-sm text-ink-muted"
          role="status"
          data-testid="map-view-unavailable"
        >
          {t('map.unavailable')}
        </div>
      ) : null}
      {selectedPin !== null ? (
        <div className="absolute inset-x-2 bottom-2" data-testid="map-view-selected-pin-panel">
          <PharmacyPinPopup pin={selectedPin} />
        </div>
      ) : null}
    </div>
  )
}
