/**
 * Типы и merge-функции для обновления заявки `PharmacyAccount`. Вынесено в
 * `value-objects/` чтобы избежать цикла entity ↔ helpers.
 */
import { type PharmacyAccountProps } from '../pharmacy-account-entity.types.js'

export interface AccountUpdate {
  readonly name?: string
  readonly addressText?: string
  readonly landmarkTj?: string | null
  readonly latitude?: number
  readonly longitude?: number
  readonly phone?: string
  readonly is24_7?: boolean
  readonly openingTime?: string | null
  readonly closingTime?: string | null
  readonly licenseNumber?: string
  readonly licenseExpiryDate?: Date | null
  readonly licenseScanUrl?: string | null
  readonly pharmacistInChargeName?: string | null
}

export type MergedAccountUpdate = Omit<
  PharmacyAccountProps,
  'id' | 'chainId' | 'status' | 'suspensionReason' | 'isActive' | 'submittedAt'
>

function pickString(upd: string | undefined, cur: string): string {
  return upd ?? cur
}

function pickStringOrNull(upd: string | null | undefined, cur: string | null): string | null {
  return upd ?? cur
}

function pickNumber(upd: number | undefined, cur: number): number {
  return upd ?? cur
}

function pickBool(upd: boolean | undefined, cur: boolean): boolean {
  return upd ?? cur
}

function pickDateOrNull(upd: Date | null | undefined, cur: Date | null): Date | null {
  return upd ?? cur
}

/**
 * Мерж апдейта заявки в `props` агрегата. Неизменяемые поля (`id`/`chainId`/
 * `status`/`suspensionReason`/`isActive`) копируются из `current` без изменений.
 */
export function mergeAccountUpdate(current: PharmacyAccountProps, update: AccountUpdate): MergedAccountUpdate {
  return {
    name: pickString(update.name, current.name),
    addressText: pickString(update.addressText, current.addressText),
    landmarkTj: pickStringOrNull(update.landmarkTj, current.landmarkTj),
    latitude: pickNumber(update.latitude, current.latitude),
    longitude: pickNumber(update.longitude, current.longitude),
    phone: pickString(update.phone, current.phone),
    is24_7: pickBool(update.is24_7, current.is24_7),
    openingTime: pickStringOrNull(update.openingTime, current.openingTime),
    closingTime: pickStringOrNull(update.closingTime, current.closingTime),
    licenseNumber: pickString(update.licenseNumber, current.licenseNumber),
    licenseIssuingAuthority: current.licenseIssuingAuthority,
    licenseIssueDate: current.licenseIssueDate,
    licenseExpiryDate: pickDateOrNull(update.licenseExpiryDate, current.licenseExpiryDate),
    licenseScanUrl: pickStringOrNull(update.licenseScanUrl, current.licenseScanUrl),
    pharmacistInChargeName: pickStringOrNull(update.pharmacistInChargeName, current.pharmacistInChargeName),
  }
}
