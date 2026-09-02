/**
 * `GeoPoint` Value Object (EP-01, DTJ-009, SRS-DOM-072/073) — координаты
 * WGS-84 с диапазонной валидацией + мягкой проверкой «похоже на
 * Таджикистан» + расстоянием по гаверсинусу.
 *
 * Используется модулем доставки (EP-13) для расчёта расстояния курьер↔клиент.
 *
 * `isLikelyWithinTajikistan()` — НЕ блокирующая проверка (GPS-дрейф,
 * приграничные районы). Только UX-warning («координаты похожи на
 * Самарканд, вы уверены?»).
 */
import { err, ok, type Result } from '@dorutj/domain-kernel'
import { InvalidCoordinatesError } from '@/shared-kernel/domain/errors/invalid-coordinates.error.js'

const LAT_MIN = -90
const LAT_MAX = 90
const LON_MIN = -180
const LON_MAX = 180

/** Мягкий bbox Таджикистана (SRS-DOM-072). НЕ блокирует. */
const TAJIKISTAN_LAT_MIN = 36.6
const TAJIKISTAN_LAT_MAX = 41.1
const TAJIKISTAN_LON_MIN = 67.3
const TAJIKISTAN_LON_MAX = 75.2

const EARTH_RADIUS_METERS = 6_371_000

export class GeoPoint {
  private constructor(
    readonly latitude: number,
    readonly longitude: number,
  ) {}

  /**
   * `Result`-конструктор: `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`. Невалидный
   * диапазон → `InvalidCoordinatesError` (HTTP 400 `INVALID_COORDINATES`).
   */
  static create(latitude: number, longitude: number): Result<GeoPoint, InvalidCoordinatesError> {
    if (typeof latitude !== 'number' || Number.isNaN(latitude) || latitude < LAT_MIN || latitude > LAT_MAX) {
      return err(
        new InvalidCoordinatesError({
          field: 'latitude',
          value: latitude,
          min: LAT_MIN,
          max: LAT_MAX,
        }),
      )
    }
    if (typeof longitude !== 'number' || Number.isNaN(longitude) || longitude < LON_MIN || longitude > LON_MAX) {
      return err(
        new InvalidCoordinatesError({
          field: 'longitude',
          value: longitude,
          min: LON_MIN,
          max: LON_MAX,
        }),
      )
    }
    return ok(new GeoPoint(latitude, longitude))
  }

  /** Мягкая проверка «похоже на Таджикистан». НЕ блокирует. */
  isLikelyWithinTajikistan(): boolean {
    return (
      this.latitude >= TAJIKISTAN_LAT_MIN &&
      this.latitude <= TAJIKISTAN_LAT_MAX &&
      this.longitude >= TAJIKISTAN_LON_MIN &&
      this.longitude <= TAJIKISTAN_LON_MAX
    )
  }

  /** Расстояние в метрах (haversine formula, SRS-DOM-073). */
  distanceTo(other: GeoPoint): number {
    const lat1 = toRadians(this.latitude)
    const lat2 = toRadians(other.latitude)
    const deltaLat = toRadians(other.latitude - this.latitude)
    const deltaLon = toRadians(other.longitude - this.longitude)
    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return EARTH_RADIUS_METERS * c
  }
}

const DEGREES_PER_HALF_TURN = 180

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / DEGREES_PER_HALF_TURN
}
