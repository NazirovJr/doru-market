/**
 * Тест санитизации `error_detail` (EP-05, DTJ-155, критерий 3).
 */
import { describe, expect, it } from 'vitest'
import { sanitizeErrorDetail } from './sanitize-error-detail.js'

describe('sanitizeErrorDetail (DTJ-155, критерий 3)', () => {
  it('маскирует X-Pharmacy-Api-Key', () => {
    const text = 'request header: X-Pharmacy-Api-Key: super-secret-key-12345, response: 500'
    const out = sanitizeErrorDetail(text)
    expect(out).not.toContain('super-secret-key-12345')
    expect(out).toContain('<redacted>')
  })

  it('маскирует X-Pharmacy-Signature (base64)', () => {
    const text = 'X-Pharmacy-Signature: abcDEFghiJKL123+/=XYZ  failed'
    const out = sanitizeErrorDetail(text)
    expect(out).not.toContain('abcDEFghiJKL123+/=XYZ')
  })

  it('маскирует Authorization: Bearer <jwt>', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature12345'
    const out = sanitizeErrorDetail(text)
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(out).not.toContain('signature12345')
  })

  it('маскирует голые JWT в произвольной строке', () => {
    const text = 'error happened with token=eyJabc1234567890def.eyJ0987654321fedcba.payload123abcXYZ'
    const out = sanitizeErrorDetail(text)
    expect(out).not.toContain('eyJabc1234567890def')
  })

  it('маскирует UUIDv7 токены', () => {
    const text = 'sessionId=0192f3b4-7c8d-7abc-9def-0123456789ab in error'
    const out = sanitizeErrorDetail(text)
    expect(out).not.toContain('0192f3b4-7c8d-7abc-9def-0123456789ab')
  })

  it('НЕ трогает обычный текст без секретов', () => {
    const text = 'Connection refused: ECONNREFUSED 127.0.0.1:5432'
    const out = sanitizeErrorDetail(text)
    expect(out).toBe(text)
  })

  it('несколько секретов в одной строке маскируются все', () => {
    const text =
      'headers: X-Pharmacy-Api-Key: kkk1, X-Pharmacy-Signature: sss1, Authorization: Bearer eyJ1.eyJ2.signature'
    const out = sanitizeErrorDetail(text)
    expect(out).not.toContain('kkk1')
    expect(out).not.toContain('sss1')
    expect(out).not.toContain('eyJ1.eyJ2')
  })
})
