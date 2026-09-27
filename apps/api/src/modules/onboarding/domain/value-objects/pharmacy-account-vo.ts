/**
 * Helper-функции `PharmacyAccount` aggregate (вынесены из entity в `value-objects/`
 * чтобы избежать циклической зависимости entity ↔ helpers).
 *
 * Чистые функции без побочных эффектов, импортируются только `pharmacy-account.entity.ts`.
 */
import { ValidationError } from '@dorutj/contracts'
import { type OnboardingStatus } from './onboarding-status.vo.js'

const NAME_MAX_LENGTH = 255
const ADDRESS_MAX_LENGTH = 1024
const LICENSE_NUMBER_MAX_LENGTH = 100
const LATITUDE_MIN = -90
const LATITUDE_MAX = 90
const LONGITUDE_MIN = -180
const LONGITUDE_MAX = 180
// DTJ-367 (SRS-ADM-050): верхний предел радиуса — ASSUMPTION, спека не задаёт число явно.
const MAX_DELIVERY_RADIUS_KM_UPPER_BOUND = 50

export function validateLength(value: string, field: string, max: number): void {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new ValidationError(`Invalid ${field}: empty or exceeds ${String(max)} chars`, { field })
  }
}

export function validateCoordinates(lat: number, lon: number): void {
  if (typeof lat !== 'number' || lat < LATITUDE_MIN || lat > LATITUDE_MAX) {
    throw new ValidationError(
      `Invalid latitude: must be in [${String(LATITUDE_MIN)}, ${String(LATITUDE_MAX)}]`,
      { field: 'latitude' },
    )
  }
  if (typeof lon !== 'number' || lon < LONGITUDE_MIN || lon > LONGITUDE_MAX) {
    throw new ValidationError(
      `Invalid longitude: must be in [${String(LONGITUDE_MIN)}, ${String(LONGITUDE_MAX)}]`,
      { field: 'longitude' },
    )
  }
}

/** DTJ-367 (SRS-ADM-050): `> 0`, верхний предел — ASSUMPTION (см. константу выше). */
export function validateDeliveryRadiusKm(radiusKm: number): void {
  if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > MAX_DELIVERY_RADIUS_KM_UPPER_BOUND) {
    throw new ValidationError(
      `Invalid maxDeliveryRadiusKm: must be in (0, ${String(MAX_DELIVERY_RADIUS_KM_UPPER_BOUND)}]`,
      { field: 'maxDeliveryRadiusKm' },
    )
  }
}

// ASSUMPTION: НЕ проверяет openingTime<closingTime (расходится с тикетом DTJ-367) — интервал через полночь легитимен (PharmacyOpeningHoursPolicy, DTJ-184); единственный инвариант — оба поля обязательны, если не 24/7.
export function assertScheduleConsistency(update: {
  readonly isOpen247: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
}): void {
  if (update.isOpen247) {
    return
  }
  if (update.openingTime === null || update.closingTime === null) {
    throw new ValidationError('openingTime and closingTime are required unless isOpen247 is true', {
      field: 'openingTime',
    })
  }
}

export function assertUpdatableStatus(status: OnboardingStatus): void {
  if (status !== 'draft' && status !== 'rejected') {
    throw new ValidationError(`Cannot update application fields when status is ${status}`, {
      field: 'status',
    })
  }
}

export { NAME_MAX_LENGTH, ADDRESS_MAX_LENGTH, LICENSE_NUMBER_MAX_LENGTH }
