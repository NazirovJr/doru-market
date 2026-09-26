/**
 * `CryptoOtpGeneratorAdapter` (EP-01, DTJ-010; длина по `purpose` — ДОБАВЛЕНО DTJ-305,
 * SRS-DOM-080) — `'login'`/`'onboarding_contact'` — 6 цифр, `'delivery_handover'` — 4 (TC-PHT-016:
 * «handoverOtp.code — ровно 4 цифры»).
 */
import { describe, expect, it } from 'vitest'
import type { AppConfigService } from '@/config/app-config.service.js'
import { CryptoOtpGeneratorAdapter } from './crypto-otp-generator.adapter.js'

function adapter(devFixedOtp = false): CryptoOtpGeneratorAdapter {
  return new CryptoOtpGeneratorAdapter({ devFixedOtp } as AppConfigService)
}

describe('CryptoOtpGeneratorAdapter.generate()', () => {
  it.each(['login', 'onboarding_contact'] as const)('purpose=%s → 6-значный числовой код', (purpose) => {
    const { code, codeHash } = adapter().generate(purpose)
    expect(code).toMatch(/^\d{6}$/)
    expect(codeHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('purpose=delivery_handover → РОВНО 4-значный числовой код (SRS-DOM-080, TC-PHT-016)', () => {
    const { code } = adapter().generate('delivery_handover')
    expect(code).toMatch(/^\d{4}$/)
  })

  it('devFixedOtp → код из нулей той же длины', () => {
    expect(adapter(true).generate('login').code).toBe('000000')
    expect(adapter(true).generate('delivery_handover').code).toBe('0000')
  })
})
