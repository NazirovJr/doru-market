/**
 * Типы данных `PharmacyAccount` aggregate (вынесены из entity, чтобы избежать
 * циклических импортов: entity импортирует helpers, helpers импортируют типы).
 */
import { type OnboardingStatus } from './value-objects/onboarding-status.vo.js'

export const PHARMACY_SUSPENSION_REASONS = [
  'license_expired',
  'license_revoked',
  'fraud_or_safety',
  'policy_violation',
  'voluntary_pause',
  'unpaid_invoice',
] as const

export type PharmacySuspensionReason = (typeof PHARMACY_SUSPENSION_REASONS)[number]

/** Причины, требующие принудительной отмены незавершённых заказов (SRS-ADM-016, DTJ-071). */
export const PHARMACY_SUSPENSION_REASONS_REQUIRING_FORCE_CANCEL: ReadonlySet<PharmacySuspensionReason> =
  new Set<PharmacySuspensionReason>(['fraud_or_safety', 'license_revoked'])

export const CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE: ReadonlySet<OnboardingStatus> = new Set([
  'approved',
  'active',
])

/** DTJ-367 (SRS-ADM-050): дефолт совпадает с DEFAULT колонки `migrations/0059`. */
export const DEFAULT_MAX_DELIVERY_RADIUS_KM = 10.0

export interface PharmacyAccountCreateCommand {
  readonly id: string
  readonly chainId: string
  readonly name: string
  readonly addressText: string
  readonly latitude: number
  readonly longitude: number
  readonly phone: string
  readonly licenseNumber: string
  readonly licenseExpiryDate: Date
}

export interface PharmacyAccountProps {
  readonly id: string
  readonly chainId: string
  readonly name: string
  readonly addressText: string
  readonly landmarkTj: string | null
  readonly latitude: number
  readonly longitude: number
  readonly phone: string
  readonly is24_7: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
  readonly maxDeliveryRadiusKm: number
  readonly licenseNumber: string
  readonly licenseIssuingAuthority: string | null
  readonly licenseIssueDate: Date | null
  readonly licenseExpiryDate: Date | null
  readonly licenseScanUrl: string | null
  readonly pharmacistInChargeName: string | null
  readonly status: OnboardingStatus
  readonly suspensionReason: PharmacySuspensionReason | null
  readonly isActive: boolean
  readonly submittedAt: Date | null
}
