import { toIntlLocale, type Locale, type TranslateFunction } from '@dorutj/i18n'

const METERS_PER_KM = 1000
const KM_FRACTION_DIGITS = 1

export function formatDistanceLabel(
  meters: number | null,
  locale: Locale,
  t: TranslateFunction,
): string | undefined {
  if (meters === null) {
    return undefined
  }
  if (meters < METERS_PER_KM) {
    return t('catalog.search.distance_m', { distance: Math.round(meters) })
  }
  const km = new Intl.NumberFormat(toIntlLocale(locale), { maximumFractionDigits: KM_FRACTION_DIGITS }).format(
    meters / METERS_PER_KM,
  )
  return t('catalog.search.distance_km', { distance: km })
}
