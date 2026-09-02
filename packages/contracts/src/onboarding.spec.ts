/**
 * Unit-тест zod-контрактов onboarding (DTJ-064/065/068/071/072). Стиль/структура —
 * по образцу `search.spec.ts`: таблицы кейсов на границы, отдельные describe на
 * дефолты, обязательность полей и cross-field правила (`.superRefine`).
 */
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  ApproveVerificationRequestSchema,
  ForceCancelOrdersRequestSchema,
  OnboardingDocumentUploadRequestSchema,
  PHONE_NUMBER_MESSAGE,
  RejectVerificationRequestSchema,
  RequestChangesVerificationRequestSchema,
  RequestContactPhoneOtpRequestSchema,
  RevokeVerificationRequestSchema,
  SubmitChainApplicationRequestSchema,
  SubmitChainForReviewRequestSchema,
  SubmitPharmacyApplicationRequestSchema,
  SubmitPharmacyForReviewRequestSchema,
  SuspendPharmacyRequestSchema,
  TerminateVerificationRequestSchema,
  VerifyChainContactPhoneRequestSchema,
} from './onboarding.js'

function issuePaths(error: unknown): string[] {
  expect(error).toBeInstanceOf(ZodError)
  return (error as ZodError).issues.flatMap((issue) => issue.path.map(String))
}

const validChainApplication = {
  legalEntityName: 'Farmatsiya LLC',
  tinInn: '123456789',
  directorFullName: 'Ismoilov Rustam',
  contactPhone: '+992987654321',
}

describe('SubmitChainApplicationRequestSchema', () => {
  it('минимально валидный объект проходит с дефолтами (legalAddress=null, isWhitelabelRequested=false)', () => {
    expect(SubmitChainApplicationRequestSchema.parse(validChainApplication)).toEqual({
      ...validChainApplication,
      legalAddress: null,
      isWhitelabelRequested: false,
    })
  })

  it('обязательное поле legalEntityName отсутствует → ошибка на нужном поле', () => {
    const { legalEntityName: _omit, ...rest } = validChainApplication
    try {
      SubmitChainApplicationRequestSchema.parse(rest)
      expect.unreachable('parse обязан бросить ZodError')
    } catch (error) {
      expect(issuePaths(error)).toContain('legalEntityName')
    }
  })

  it.each([
    ['8 цифр — короче минимума (9)', '12345678', false],
    ['9 цифр — минимум', '123456789', true],
    ['20 цифр — максимум', '1'.repeat(20), true],
    ['21 цифра — длиннее максимума', '1'.repeat(21), false],
  ])('tinInn: %s', (_label, value, shouldPass) => {
    const result = SubmitChainApplicationRequestSchema.safeParse({ ...validChainApplication, tinInn: value })
    expect(result.success).toBe(shouldPass)
  })

  it('tinInn с нецифровым символом → ZodError на tinInn', () => {
    try {
      SubmitChainApplicationRequestSchema.parse({ ...validChainApplication, tinInn: '12345678a' })
      expect.unreachable('parse обязан бросить ZodError')
    } catch (error) {
      expect(issuePaths(error)).toContain('tinInn')
    }
  })

  it.each(['+992987654321', '987654321'])('contactPhone: %s — валидный формат РТ проходит', (phone) => {
    expect(SubmitChainApplicationRequestSchema.parse({ ...validChainApplication, contactPhone: phone }).contactPhone).toBe(
      phone,
    )
  })

  it('contactPhone неверного формата → ZodError с сообщением PHONE_NUMBER_MESSAGE', () => {
    const result = SubmitChainApplicationRequestSchema.safeParse({ ...validChainApplication, contactPhone: '12345' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === PHONE_NUMBER_MESSAGE)).toBe(true)
    }
  })

  it('registrationCertificateUrl невалидный URL → ZodError', () => {
    expect(() =>
      SubmitChainApplicationRequestSchema.parse({ ...validChainApplication, registrationCertificateUrl: 'not-a-url' }),
    ).toThrow(ZodError)
  })

  describe('superRefine: isWhitelabelRequested=true требует legalAddress и registrationCertificateUrl', () => {
    it('оба поля отсутствуют → две ошибки на нужных путях', () => {
      try {
        SubmitChainApplicationRequestSchema.parse({ ...validChainApplication, isWhitelabelRequested: true })
        expect.unreachable('parse обязан бросить ZodError')
      } catch (error) {
        const paths = issuePaths(error)
        expect(paths).toContain('legalAddress')
        expect(paths).toContain('registrationCertificateUrl')
      }
    })

    it('legalAddress — пустая строка после trim тоже считается отсутствующей', () => {
      try {
        SubmitChainApplicationRequestSchema.parse({
          ...validChainApplication,
          isWhitelabelRequested: true,
          legalAddress: '   ',
          registrationCertificateUrl: 'https://example.tj/cert.pdf',
        })
        expect.unreachable('parse обязан бросить ZodError')
      } catch (error) {
        expect(issuePaths(error)).toContain('legalAddress')
      }
    })

    it('оба поля заданы корректно → проходит без ошибок', () => {
      const parsed = SubmitChainApplicationRequestSchema.parse({
        ...validChainApplication,
        isWhitelabelRequested: true,
        legalAddress: 'Dushanbe, Rudaki 1',
        registrationCertificateUrl: 'https://example.tj/cert.pdf',
      })
      expect(parsed.isWhitelabelRequested).toBe(true)
    })

    it('isWhitelabelRequested=false — legalAddress/registrationCertificateUrl не требуются', () => {
      expect(SubmitChainApplicationRequestSchema.parse(validChainApplication).legalAddress).toBeNull()
    })
  })
})

describe('VerifyChainContactPhoneRequestSchema', () => {
  it.each([
    ['3 цифры — короче минимума', '123', false],
    ['4 цифры — минимум', '1234', true],
    ['6 цифр — максимум', '123456', true],
    ['7 цифр — длиннее максимума', '1234567', false],
  ])('code: %s', (_label, value, shouldPass) => {
    expect(VerifyChainContactPhoneRequestSchema.safeParse({ code: value }).success).toBe(shouldPass)
  })
})

describe('Schema без тела (strict, пустой объект)', () => {
  it.each([
    ['RequestContactPhoneOtpRequestSchema', RequestContactPhoneOtpRequestSchema],
    ['SubmitChainForReviewRequestSchema', SubmitChainForReviewRequestSchema],
    ['SubmitPharmacyForReviewRequestSchema', SubmitPharmacyForReviewRequestSchema],
  ] as const)('%s: пустой объект проходит, лишнее поле отклоняется (.strict())', (_name, schema) => {
    expect(schema.parse({})).toEqual({})
    expect(schema.safeParse({ extra: 'field' }).success).toBe(false)
  })
})

const validPharmacyApplication = {
  tinInn: '123456789',
  name: 'Aptека №1',
  addressText: 'Dushanbe, Rudaki 5',
  latitude: 38.5598,
  longitude: 68.787,
  phone: '+992987654321',
  licenseNumber: 'LIC-001',
  licenseExpiryDate: '2030-01-01',
  pharmacistInChargeName: 'Karimova Nigora',
}

describe('SubmitPharmacyApplicationRequestSchema', () => {
  it('валидный объект (solo pharmacy, tinInn задан) проходит с дефолтом isOpen247=false', () => {
    const parsed = SubmitPharmacyApplicationRequestSchema.parse(validPharmacyApplication)
    expect(parsed.isOpen247).toBe(false)
    expect(parsed.name).toBe('Aptека №1')
  })

  it.each([
    ['latitude', -90, true],
    ['latitude', 90, true],
    ['latitude', -90.0001, false],
    ['latitude', 90.0001, false],
    ['longitude', -180, true],
    ['longitude', 180, true],
    ['longitude', -180.0001, false],
    ['longitude', 180.0001, false],
  ])('%s=%d на/за границей WGS-84 → success=%s', (field, value, shouldPass) => {
    const result = SubmitPharmacyApplicationRequestSchema.safeParse({ ...validPharmacyApplication, [field]: value })
    expect(result.success).toBe(shouldPass)
  })

  it('licenseScanUrl невалидный URL → ZodError', () => {
    expect(() =>
      SubmitPharmacyApplicationRequestSchema.parse({ ...validPharmacyApplication, licenseScanUrl: 'not-a-url' }),
    ).toThrow(ZodError)
  })

  it('licenseScanUrl валидный URL проходит', () => {
    const parsed = SubmitPharmacyApplicationRequestSchema.parse({
      ...validPharmacyApplication,
      licenseScanUrl: 'https://example.tj/license.pdf',
    })
    expect(parsed.licenseScanUrl).toBe('https://example.tj/license.pdf')
  })

  describe('superRefine: без chainId tinInn обязателен', () => {
    it('chainId отсутствует, tinInn отсутствует → ошибка на tinInn', () => {
      const { tinInn: _omit, ...rest } = validPharmacyApplication
      try {
        SubmitPharmacyApplicationRequestSchema.parse(rest)
        expect.unreachable('parse обязан бросить ZodError')
      } catch (error) {
        expect(issuePaths(error)).toContain('tinInn')
      }
    })

    it('chainId отсутствует, tinInn пустая строка → ошибка на tinInn', () => {
      try {
        SubmitPharmacyApplicationRequestSchema.parse({ ...validPharmacyApplication, tinInn: '' })
        expect.unreachable('parse обязан бросить ZodError')
      } catch (error) {
        expect(issuePaths(error)).toContain('tinInn')
      }
    })

    it('chainId задан — tinInn необязателен, проходит без ошибок', () => {
      const { tinInn: _omit, ...rest } = validPharmacyApplication
      const parsed = SubmitPharmacyApplicationRequestSchema.parse({
        ...rest,
        chainId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      })
      expect(parsed.tinInn).toBeUndefined()
    })
  })
})

describe('OnboardingDocumentUploadRequestSchema', () => {
  const valid = { base64: 'ZmFrZQ==', mimeType: 'application/pdf', fileName: 'license.pdf' }

  it('валидный объект проходит без изменений', () => {
    expect(OnboardingDocumentUploadRequestSchema.parse(valid)).toEqual(valid)
  })

  it.each(['base64', 'mimeType', 'fileName'] as const)('пустая строка в %s → ZodError (min(1))', (field) => {
    expect(OnboardingDocumentUploadRequestSchema.safeParse({ ...valid, [field]: '' }).success).toBe(false)
  })
})

describe('ApproveVerificationRequestSchema', () => {
  it('checklist обязателен, notes опционален', () => {
    const parsed = ApproveVerificationRequestSchema.parse({ checklist: { hasLicense: true } })
    expect(parsed).toEqual({ checklist: { hasLicense: true } })
  })

  it('checklist отсутствует → ZodError на checklist', () => {
    try {
      ApproveVerificationRequestSchema.parse({})
      expect.unreachable('parse обязан бросить ZodError')
    } catch (error) {
      expect(issuePaths(error)).toContain('checklist')
    }
  })

  it('notes длиннее 2000 символов → ZodError', () => {
    expect(
      ApproveVerificationRequestSchema.safeParse({ checklist: {}, notes: 'x'.repeat(2001) }).success,
    ).toBe(false)
  })

  it('notes длиной ровно 2000 символов проходит (граница)', () => {
    expect(
      ApproveVerificationRequestSchema.safeParse({ checklist: {}, notes: 'x'.repeat(2000) }).success,
    ).toBe(true)
  })
})

describe('Схемы на базе ReasonRequestBase — reason min(1)/max(2000)', () => {
  it.each([
    ['RequestChangesVerificationRequestSchema', RequestChangesVerificationRequestSchema],
    ['RejectVerificationRequestSchema', RejectVerificationRequestSchema],
    ['TerminateVerificationRequestSchema', TerminateVerificationRequestSchema],
    ['ForceCancelOrdersRequestSchema', ForceCancelOrdersRequestSchema],
    ['RevokeVerificationRequestSchema', RevokeVerificationRequestSchema],
  ] as const)('%s: пустая reason отклоняется, 1 символ и 2000 символов проходят, 2001 отклоняется', (_name, schema) => {
    expect(schema.safeParse({ reason: '' }).success).toBe(false)
    expect(schema.safeParse({ reason: 'x' }).success).toBe(true)
    expect(schema.safeParse({ reason: 'x'.repeat(2000) }).success).toBe(true)
    expect(schema.safeParse({ reason: 'x'.repeat(2001) }).success).toBe(false)
  })
})

describe('SuspendPharmacyRequestSchema', () => {
  it.each([
    'license_expired',
    'license_revoked',
    'fraud_or_safety',
    'policy_violation',
    'voluntary_pause',
    'unpaid_invoice',
  ] as const)('reason=%s — допустимое значение перечисления', (reason) => {
    expect(SuspendPharmacyRequestSchema.parse({ reason }).reason).toBe(reason)
  })

  it('недопустимое значение reason → ZodError', () => {
    expect(SuspendPharmacyRequestSchema.safeParse({ reason: 'other' }).success).toBe(false)
  })

  it('notes опционален и ограничен 2000 символами', () => {
    expect(SuspendPharmacyRequestSchema.parse({ reason: 'voluntary_pause' }).notes).toBeUndefined()
    expect(
      SuspendPharmacyRequestSchema.safeParse({ reason: 'voluntary_pause', notes: 'x'.repeat(2001) }).success,
    ).toBe(false)
  })
})
