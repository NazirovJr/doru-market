import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import type { MapPin } from '../model/map-pin'

/**
 * `pharmacy-pin-popup.tsx` (DTJ-198, критерий приёмки 4).
 *
 * Содержимое maplibre-gl `Popup` — обычный React-компонент (рендерится через `createRoot` в
 * `map-view.tsx`, НЕ через HTML-строку `Popup.setHTML`). Имя аптеки выводится как текстовый
 * children JSX — React экранирует его при рендере, поэтому `<script>` в имени не исполняется
 * (негативный сценарий безопасности из тест-плана).
 */

const DIRAM_PER_SOMONI = 100

export interface PharmacyPinPopupProps {
  readonly pin: MapPin
}

function formatSomoni(priceDiram: number): string {
  return (priceDiram / DIRAM_PER_SOMONI).toFixed(2)
}

interface OpeningHoursLabelProps {
  readonly pin: MapPin
  readonly t: (key: string) => string
}

function OpeningHoursLabel({ pin, t }: OpeningHoursLabelProps): ReactElement {
  if (pin.is24x7) {
    return <>{t('map.pin.open_24_7')}</>
  }
  return <>{pin.isOpenNow ? t('map.pin.open_now') : t('map.pin.closed_now')}</>
}

export function PharmacyPinPopup({ pin }: PharmacyPinPopupProps): ReactElement {
  const { t } = useT(useLocale().locale)

  return (
    <div
      className="min-w-[180px] max-w-[240px] rounded-md bg-surface p-2 text-ink"
      data-testid="pharmacy-pin-popup"
    >
      <p className="text-sm font-semibold">{pin.name}</p>
      <p className="text-xs text-ink-muted" data-testid="pharmacy-pin-popup-hours">
        <OpeningHoursLabel pin={pin} t={t} />
      </p>
      {pin.offer !== null ? (
        <div className="mt-1 border-t border-line pt-1">
          <p className="text-sm font-medium" data-testid="pharmacy-pin-popup-price">
            {t('map.pin.price', { price: formatSomoni(pin.offer.priceDiram) })}
          </p>
          <p className="text-xs text-ink-muted" data-testid="pharmacy-pin-popup-stock">
            {t('map.pin.stock', { count: pin.offer.stockQuantity })}
          </p>
          {pin.offer.isStale ? (
            <p className="text-xs text-ink-muted" data-testid="pharmacy-pin-popup-stale">
              {t('map.pin.stale')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
