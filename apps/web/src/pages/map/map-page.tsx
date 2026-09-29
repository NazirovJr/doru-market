import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { useSearchParams } from 'react-router'
import type { BboxCoordinates, PharmacyMapPinDto } from '@dorutj/contracts'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { IconButton, MapView, type BBox, type MapPoint } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import type { HttpError } from '@/shared/api/http-client'
import { usePharmacyMapPins } from '@/features/pharmacy-map/api/use-pharmacy-map-pins'
import { PharmacyPinPopup } from '@/features/pharmacy-map/ui/pharmacy-pin-popup'

// MapView домен-агностичен: маппинг PharmacyMapPinDto -> MapPoint и попап выбранной аптеки
// (панель снизу, не встроенный попап карты) — ответственность этой страницы, не компонента.

const DEFAULT_MAP_CENTER = { lat: 38.5598, lng: 68.787 } // Душанбе
const DEFAULT_MAP_ZOOM = 12
const DEFAULT_MAP_BBOX: BboxCoordinates = { lonMin: 68.65, latMin: 38.48, lonMax: 68.92, latMax: 38.64 }
const MAX_MAP_PINS_PER_RESPONSE = 500

function toBboxCoordinates(bbox: BBox): BboxCoordinates {
  return { lonMin: bbox.west, latMin: bbox.south, lonMax: bbox.east, latMax: bbox.north }
}

function pinToMapPoint(pin: PharmacyMapPinDto): MapPoint {
  return { id: pin.pharmacyId, lat: pin.lat, lng: pin.lon, label: pin.name, meta: pin }
}

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

interface SelectedPharmacyPanelProps {
  readonly pin: PharmacyMapPinDto
  readonly t: TranslateFunction
  readonly onClose: () => void
}

const SelectedPharmacyPanel = ({ pin, t, onClose }: SelectedPharmacyPanelProps): ReactElement => (
  <div
    data-testid="map-page-selected-pharmacy"
    className="absolute inset-x-0 bottom-0 flex items-start justify-between gap-2 bg-surface p-2 shadow-md"
  >
    <PharmacyPinPopup pin={pin} />
    <IconButton aria-label={t('common.close')} icon={<span aria-hidden="true">×</span>} onClick={onClose} />
  </div>
)

const MapPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [searchParams] = useSearchParams()
  const medicineId = searchParams.get('medicineId') ?? undefined

  const [bbox, setBbox] = useState<BboxCoordinates>(DEFAULT_MAP_BBOX)
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string | null>(null)
  const query = usePharmacyMapPins({ bbox, medicineId })

  const handleViewportChange = useCallback((nextBbox: BBox): void => {
    setBbox(toBboxCoordinates(nextBbox))
  }, [])

  const handleRetry = useCallback((): void => {
    void query.refetch()
  }, [query])

  const pins = query.data ?? []
  const points = useMemo(() => pins.map(pinToMapPoint), [pins])
  const selectedPin = pins.find((pin) => pin.pharmacyId === selectedPharmacyId) ?? null
  // `isPending` без данных вообще (в т.ч. из placeholderData) — самая первая загрузка страницы;
  // на панорамирование/зум `placeholderData: keepPreviousData` держит старые пины на экране.
  const isInitialLoading = query.isPending

  return (
    <section className="relative h-[70vh] w-full" data-testid="map-page">
      <MapView
        points={points}
        center={DEFAULT_MAP_CENTER}
        zoom={DEFAULT_MAP_ZOOM}
        mode="full"
        tileStyleUrl={import.meta.env.VITE_TILESERVER_URL}
        onSelect={setSelectedPharmacyId}
        onViewportChange={handleViewportChange}
        unavailableSlot={
          <div role="status" data-testid="map-view-unavailable" className="flex h-full w-full items-center justify-center bg-surface p-4 text-center text-sm text-ink-muted">
            {t('map.unavailable')}
          </div>
        }
      />
      <MapPageBanner
        isInitialLoading={isInitialLoading}
        error={query.error}
        pinsCount={pins.length}
        t={t}
        onRetry={handleRetry}
      />
      {selectedPin !== null ? (
        <SelectedPharmacyPanel
          pin={selectedPin}
          t={t}
          onClose={() => {
            setSelectedPharmacyId(null)
          }}
        />
      ) : null}
    </section>
  )
}

export default MapPage
