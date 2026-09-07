import { describe, expect, it } from 'vitest'
import {
  createInitialOnboardingFormState,
  hasErrors,
  onboardingFormReducer,
  validateChainFields,
  validatePharmacyFields,
  type OnboardingFormState,
} from './onboarding-form.model'

/**
 * `onboarding-form.model.spec.ts` (DTJ-076) — валидация чистой модели: reducer + правила
 * `SubmitChainApplicationRequestSchema`/`SubmitPharmacyApplicationRequestSchema` через
 * `validateChainFields`/`validatePharmacyFields`. Покрывает AC2 (whitelabel требует
 * `legalAddress`) на уровне модели — `pharmacy-application-form.spec.tsx` покрывает то же на
 * уровне UI (блокировка сабмита + локализованная ошибка у поля).
 */

const VALID_CHAIN_FIELDS: Partial<OnboardingFormState> = {
  legalEntityName: 'Фарм Сервис',
  tinInn: '123456789',
  directorFullName: 'Иванов Иван',
  contactPhone: '+992901234567',
}

function stateWith(overrides: Partial<OnboardingFormState>): OnboardingFormState {
  return { ...createInitialOnboardingFormState(), ...VALID_CHAIN_FIELDS, ...overrides }
}

describe('onboardingFormReducer', () => {
  it('1. set_field обновляет ровно одно текстовое поле', () => {
    const state = createInitialOnboardingFormState()
    const next = onboardingFormReducer(state, { type: 'set_field', field: 'legalEntityName', value: 'Аптека №1' })
    expect(next.legalEntityName).toBe('Аптека №1')
    expect(next.tinInn).toBe(state.tinInn)
  })

  it('2. set_whitelabel переключает флаг', () => {
    const state = createInitialOnboardingFormState()
    const next = onboardingFormReducer(state, { type: 'set_whitelabel', value: true })
    expect(next.isWhitelabelRequested).toBe(true)
  })

  it('3. set_registration_certificate_url / set_license_scan_url сохраняют URL загруженного документа', () => {
    const state = createInitialOnboardingFormState()
    const withCert = onboardingFormReducer(state, {
      type: 'set_registration_certificate_url',
      url: 'https://cdn.example/cert.pdf',
    })
    expect(withCert.registrationCertificateUrl).toBe('https://cdn.example/cert.pdf')
    const withLicense = onboardingFormReducer(withCert, {
      type: 'set_license_scan_url',
      url: 'https://cdn.example/license.pdf',
    })
    expect(withLicense.licenseScanUrl).toBe('https://cdn.example/license.pdf')
    expect(withLicense.registrationCertificateUrl).toBe('https://cdn.example/cert.pdf')
  })
})

describe('validateChainFields (AC2)', () => {
  it('1. валидные поля юрлица без whitelabel — ноль ошибок', () => {
    const errors = validateChainFields(stateWith({ isWhitelabelRequested: false }))
    expect(hasErrors(errors)).toBe(false)
  })

  it('2. isWhitelabelRequested=true БЕЗ legalAddress — ошибка ИМЕННО у legalAddress (и registrationCertificateUrl)', () => {
    const errors = validateChainFields(
      stateWith({ isWhitelabelRequested: true, legalAddress: '', registrationCertificateUrl: null }),
    )
    expect(errors.legalAddress).toBe('required')
    expect(errors.registrationCertificateUrl).toBe('required')
  })

  it('3. isWhitelabelRequested=true С legalAddress и registrationCertificateUrl — ноль ошибок', () => {
    const errors = validateChainFields(
      stateWith({
        isWhitelabelRequested: true,
        legalAddress: 'г. Душанбе, ул. Рудаки, 1',
        registrationCertificateUrl: 'https://cdn.example/cert.pdf',
      }),
    )
    expect(hasErrors(errors)).toBe(false)
  })

  it('4. невалидный формат contactPhone — ошибка у contactPhone', () => {
    const errors = validateChainFields(stateWith({ contactPhone: '12345' }))
    expect(errors.contactPhone).toBe('required')
  })
})

describe('validatePharmacyFields', () => {
  it('1. валидные поля точки с реальным chainId — ноль ошибок', () => {
    const state = stateWith({
      name: 'Аптека на Рудаки',
      addressText: 'ул. Рудаки, 12',
      licenseNumber: 'LIC-001',
      licenseExpiryDate: '2030-01-01',
      pharmacistInChargeName: 'Каримова Зарина',
    })
    const errors = validatePharmacyFields(state, '11111111-1111-4111-8111-111111111111')
    expect(hasErrors(errors)).toBe(false)
  })

  it('2. пустое обязательное поле точки (name) — ошибка у name, chainId-заглушка не мешает', () => {
    const state = stateWith({ name: '', addressText: 'ул. Рудаки, 12', licenseNumber: 'LIC-001', licenseExpiryDate: '2030-01-01', pharmacistInChargeName: 'Каримова Зарина' })
    const errors = validatePharmacyFields(state, null)
    expect(errors.name).toBe('required')
  })
})
