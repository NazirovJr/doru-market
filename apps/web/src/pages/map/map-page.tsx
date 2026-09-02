import { useCallback, useState, type ReactElement } from 'react'
import { useSearchParams } from 'react-router'
import type { BboxCoordinates } from '@dorutj/contracts'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import type { HttpError } from '@/shared/api/http-client'
import { MapView } from '@/features/pharmacy-map/ui/map-view'
import { usePharmacyMapPins } from '@/features/pharmacy-map/api/use-pharmacy-map-pins'

/**
 * `map-page.tsx` (DTJ-199, `SRS-CAT-052`/`053`/`054`).
 *
 * Экран `/map`: держит текущий `bbox` в состоянии, запрашивает пины через
 * `usePharmacyMapPins` (DTJ-197 бэкенд) и передаёт их в готовый `MapView` (DTJ-198). `MapView`
 * сам подписан на `use-map-viewport` и зовёт `onViewportChange` ОДИН раз на жест (debounce уже
 * внутри, здесь достаточно положить новый `bbox` в state — второй debounce не нужен).
 *
 * Карта остаётся смонтированной и интерактивной ВО ВСЕХ состояниях (загрузка/ошибка/пустой
 * результат) — баннер поверх неё, а не замена на белый экран/спиннер на весь экран (критерий
 * приёмки тикета: "не белым экраном и не бесконечным лоадером"). Так пользователь может
 * приблизить карту прямо из состояния "bbox слишком большой", не обновляя страницу.
 *
 * `medicineId` — необязательный query-параметр (`?medicineId=<uuid>`), переход "показать на
 * карте" с карточки товара (`SRS-CAT-052`); без него пины несут только статические данные аптеки.
 */

const DEFAULT_MAP_CENTER = { lon: 68.787, lat: 38.5598 } // Душанбе — тот же дефолт, что и pharmacy-application-form.tsx
const DEFAULT_MAP_ZOOM = 12
const DEFAULT_MAP_MIN_ZOOM = 9
// Стартовый bbox ДО первого moveend/zoomend (MapView зовёт onViewportChange только на реальный
// жест) — площадь ~416 км², заведомо меньше лимита SRS-CAT-054 (2500 км²).
const DEFAULT_MAP_BBOX: BboxCoordinates = { lonMin: 68.65, latMin: 38.48, lonMax: 68.92, latMax: 38.64 }
const MAX_MAP_PINS_PER_RESPONSE = 500

function isBboxTooLargeError(error: HttpError): boolean {
  if (error.code !== 'VALIDATION_ERROR') {
    return false
  }
  const details = error.details
  if (typeof details !== 'object' || details === null) {
    return false
  }
  return (details as { readonly field?: unknown }).field === 'bbox'
}

interface MapPageBannerProps {
  readonly isInitialLoading: boolean
  readonly error: HttpError | null
  readonly pinsCount: number
  readonly t: TranslateFunction
  readonly onRetry: () => void
}

/** Ровно один баннер поверх карты — приоритет: bbox слишком большой > ошибка > пусто > лимит. */
const MapPageBanner = ({ isInitialLoading, error, pinsCount, t, onRetry }: MapPageBannerProps): ReactElement | null => {
  if (isInitialLoading) {
    return (
      <div role="status" data-testid="map-page-loading" className="absolute inset-x-0 top-0 p-3 text-center text-sm text-ink-muted">
        …
      </div>
    )
  }
  if (error !== null) {
    const isBboxTooLarge = isBboxTooLargeError(error)
    return (
      <div
        role="alert"
        data-testid={isBboxTooLarge ? 'map-page-bbox-too-large' : 'map-page-error'}
        className="absolute inset-x-0 top-0 flex flex-col items-center gap-2 bg-surface p-3 text-center text-sm text-ink"
      >
        <p>{isBboxTooLarge ? t('map.bbox_too_large') : t('ux.error.generic_500')}</p>
        {isBboxTooLarge ? null : (
          <button
            type="button"
            data-testid="map-page-retry"
            onClick={onRetry}
            className="rounded-md bg-brand-primary px-3 py-1 font-semibold text-white"
          >
            {t('ux.action.retry')}
          </button>
        )}
      </div>
    )
  }
  if (pinsCount === 0) {
    return (
      <div role="status" data-testid="map-page-empty" className="absolute inset-x-0 top-0 p-3 text-center text-sm text-ink-muted">
        {t('map.empty')}
      </div>
    )
  }
  if (pinsCount >= MAX_MAP_PINS_PER_RESPONSE) {
    return (
      <div role="status" data-testid="map-page-truncated" className="absolute inset-x-0 top-0 p-3 text-center text-sm text-ink-muted">
        {t('map.results_truncated', { limit: MAX_MAP_PINS_PER_RESPONSE })}
      </div>
    )
  }
  return null
}

const MapPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [searchParams] = useSearchParams()
  const medicineId = searchParams.get('medicineId') ?? undefined

  const [bbox, setBbox] = useState<BboxCoordinates>(DEFAULT_MAP_BBOX)
  const query = usePharmacyMapPins({ bbox, medicineId })

  const handleViewportChange = useCallback((nextBbox: BboxCoordinates): void => {
    setBbox(nextBbox)
  }, [])

  const handleRetry = useCallback((): void => {
    void query.refetch()
  }, [query])

  const pins = query.data ?? []
  // `isPending` без данных вообще (в т.ч. из placeholderData) — самая первая загрузка страницы;
  // на панорамирование/зум `placeholderData: keepPreviousData` держит старые пины на экране.
  const isInitialLoading = query.isPending

  return (
    <section className="relative h-[70vh] w-full" data-testid="map-page">
      <MapView
        center={DEFAULT_MAP_CENTER}
        zoom={DEFAULT_MAP_ZOOM}
        minZoom={DEFAULT_MAP_MIN_ZOOM}
        pins={pins}
        onViewportChange={handleViewportChange}
      />
      <MapPageBanner
        isInitialLoading={isInitialLoading}
        error={query.error}
        pinsCount={pins.length}
        t={t}
        onRetry={handleRetry}
      />
    </section>
  )
}

export default MapPage
