import type { z } from 'zod'
import {
  SubmitChainApplicationRequestSchema,
  SubmitPharmacyApplicationRequestSchema,
  type SubmitChainApplicationRequest,
  type SubmitPharmacyApplicationRequest,
} from '@dorutj/contracts'

/**
 * `onboarding-form.model.ts` (DTJ-076, «Что сделать» §1/2/3) — ЧИСТОЕ состояние формы заявки
 * аптеки/сети: поля, reducer, сборка payload'ов и валидация. Ноль импортов React/`@dorutj/i18n`
 * (тот же приём разделения, что `checkout-form.model.ts`).
 *
 * Клиентская валидация ПЕРЕИСПОЛЬЗУЕТ `SubmitChainApplicationRequestSchema`/
 * `SubmitPharmacyApplicationRequestSchema` из `@dorutj/contracts` (DoD: «не изобретать вторую
 * валидацию») — `validateChainFields`/`validatePharmacyFields` гоняют те же `.safeParse()`, что
 * сервер, и превращают issues в `{ field: 'required' }` для UI. Текст ошибки НЕ берётся из
 * `issue.message` (это захардкоженная английская строка в контракте, а не i18n-ключ) — вызывающий
 * UI сам решает, каким локализованным ключом подписать поле с ошибкой (правило 9 AGENTS.md: ноль
 * хардкода строк).
 */

const DEFAULT_LATITUDE = '38.5598' // Душанбе — карты выбора точки нет в этом тикете (см. отчёт сдачи, ДОПУЩЕНИЯ)
const DEFAULT_LONGITUDE = '68.7870'

export interface OnboardingFormState {
  readonly legalEntityName: string
  readonly tinInn: string
  readonly directorFullName: string
  readonly contactPhone: string
  readonly isWhitelabelRequested: boolean
  readonly legalAddress: string
  readonly registrationCertificateUrl: string | null
  readonly name: string
  readonly addressText: string
  readonly latitude: string
  readonly longitude: string
  readonly licenseNumber: string
  readonly licenseExpiryDate: string
  readonly pharmacistInChargeName: string
  readonly licenseScanUrl: string | null
}

export function createInitialOnboardingFormState(): OnboardingFormState {
  return {
    legalEntityName: '',
    tinInn: '',
    directorFullName: '',
    contactPhone: '',
    isWhitelabelRequested: false,
    legalAddress: '',
    registrationCertificateUrl: null,
    name: '',
    addressText: '',
    latitude: DEFAULT_LATITUDE,
    longitude: DEFAULT_LONGITUDE,
    licenseNumber: '',
    licenseExpiryDate: '',
    pharmacistInChargeName: '',
    licenseScanUrl: null,
  }
}

export type OnboardingTextField =
  | 'legalEntityName'
  | 'tinInn'
  | 'directorFullName'
  | 'contactPhone'
  | 'legalAddress'
  | 'name'
  | 'addressText'
  | 'latitude'
  | 'longitude'
  | 'licenseNumber'
  | 'licenseExpiryDate'
  | 'pharmacistInChargeName'

export type OnboardingFormAction =
  | { readonly type: 'set_field'; readonly field: OnboardingTextField; readonly value: string }
  | { readonly type: 'set_whitelabel'; readonly value: boolean }
  | { readonly type: 'set_registration_certificate_url'; readonly url: string | null }
  | { readonly type: 'set_license_scan_url'; readonly url: string | null }

export function onboardingFormReducer(
  state: OnboardingFormState,
  action: OnboardingFormAction,
): OnboardingFormState {
  switch (action.type) {
    case 'set_field':
      return { ...state, [action.field]: action.value }
    case 'set_whitelabel':
      return { ...state, isWhitelabelRequested: action.value }
    case 'set_registration_certificate_url':
      return { ...state, registrationCertificateUrl: action.url }
    case 'set_license_scan_url':
      return { ...state, licenseScanUrl: action.url }
  }
}

export function buildChainPayload(state: OnboardingFormState): SubmitChainApplicationRequest {
  return {
    legalEntityName: state.legalEntityName,
    tinInn: state.tinInn,
    directorFullName: state.directorFullName,
    contactPhone: state.contactPhone,
    legalAddress: state.legalAddress.trim().length > 0 ? state.legalAddress : null,
    isWhitelabelRequested: state.isWhitelabelRequested,
    registrationCertificateUrl: state.registrationCertificateUrl,
  }
}

/** UUID-заглушка для инлайн-валидации `SubmitPharmacyApplicationRequestSchema` ДО того, как
 *  реальный `chainId` появился (сеть ещё не создана — OTP-шаг не пройден). Схема требует
 *  `z.uuid()` для `chainId`, если он вообще передан — нам важны только ошибки ОСТАЛЬНЫХ полей на
 *  этом этапе, реальный `chainId` подставляется на финальном сабмите. */
const PLACEHOLDER_CHAIN_ID = '00000000-0000-0000-0000-000000000000'

export function buildPharmacyPayload(state: OnboardingFormState, chainId: string): SubmitPharmacyApplicationRequest {
  return {
    chainId,
    name: state.name,
    addressText: state.addressText,
    latitude: Number.parseFloat(state.latitude),
    longitude: Number.parseFloat(state.longitude),
    phone: state.contactPhone,
    isOpen247: false,
    licenseNumber: state.licenseNumber,
    licenseExpiryDate: state.licenseExpiryDate,
    pharmacistInChargeName: state.pharmacistInChargeName,
    licenseScanUrl: state.licenseScanUrl,
  }
}

export type OnboardingFieldError = 'required'
export type OnboardingFormErrors = Readonly<Partial<Record<string, OnboardingFieldError>>>

function zodIssuesToFieldErrors(issues: readonly z.core.$ZodIssue[]): OnboardingFormErrors {
  const errors: Record<string, OnboardingFieldError> = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && field.length > 0) {
      errors[field] = 'required'
    }
  }
  return errors
}

/** AC2: поля юрлица + `isWhitelabelRequested` → при `true` требует `legalAddress`/
 *  `registrationCertificateUrl` (та же `.superRefine()`, что сервер). */
export function validateChainFields(state: OnboardingFormState): OnboardingFormErrors {
  const result = SubmitChainApplicationRequestSchema.safeParse(buildChainPayload(state))
  return result.success ? {} : zodIssuesToFieldErrors(result.error.issues)
}

/** Поля точки (аптеки). `chainId` в валидации ВСЕГДА подставлен (реальный либо заглушка) —
 *  `tinInn`-ветка `.superRefine()` (обязателен только для соло-аптеки без `chainId`) в этой форме
 *  никогда не всплывает, т.к. эта форма ВСЕГДА создаёт `PharmacyChain` явно (см. JSDoc
 *  `use-contact-phone-otp.ts`, ДОПУЩЕНИЯ в отчёте сдачи). */
export function validatePharmacyFields(state: OnboardingFormState, chainId: string | null): OnboardingFormErrors {
  const result = SubmitPharmacyApplicationRequestSchema.safeParse(
    buildPharmacyPayload(state, chainId ?? PLACEHOLDER_CHAIN_ID),
  )
  return result.success ? {} : zodIssuesToFieldErrors(result.error.issues)
}

export function hasErrors(errors: OnboardingFormErrors): boolean {
  return Object.keys(errors).length > 0
}
