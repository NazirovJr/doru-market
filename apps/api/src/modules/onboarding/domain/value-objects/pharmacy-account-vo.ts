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

export function assertUpdatableStatus(status: OnboardingStatus): void {
  if (status !== 'draft' && status !== 'rejected') {
    throw new ValidationError(`Cannot update application fields when status is ${status}`, {
      field: 'status',
    })
  }
}

export { NAME_MAX_LENGTH, ADDRESS_MAX_LENGTH, LICENSE_NUMBER_MAX_LENGTH }
