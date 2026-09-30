import type { BboxCoordinates } from '@dorutj/contracts'
import type { GeoCoords } from '@/shared/geo/geo-store'

const DUSHANBE_CENTER: GeoCoords = { lat: 38.5598, lon: 68.787 }
const HALF_SPAN_LAT_DEG = 0.15
const HALF_SPAN_LON_DEG = 0.2
const COORD_DIGITS = 4

const round = (value: number): number => Number(value.toFixed(COORD_DIGITS))

// Рамка ~33×35 км — укладывается в лимит площади `pharmacies/map` (2500 км²).
export function buildOffersBbox(center: GeoCoords | null): BboxCoordinates {
  const { lat, lon } = center ?? DUSHANBE_CENTER
  return {
    lonMin: round(lon - HALF_SPAN_LON_DEG),
    latMin: round(lat - HALF_SPAN_LAT_DEG),
    lonMax: round(lon + HALF_SPAN_LON_DEG),
    latMax: round(lat + HALF_SPAN_LAT_DEG),
  }
}
