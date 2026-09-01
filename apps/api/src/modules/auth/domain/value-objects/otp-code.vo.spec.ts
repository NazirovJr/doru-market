/**
 * Тест `OtpCode` (EP-01, DTJ-010, SRS-DOM-069). Фиксирует фабрику и isExpired.
 *
 * `Date` здесь допустим как ВХОДНОЙ параметр теста — мы проверяем поведение фабрики,
 * которой нужен опорный момент. `no-restricted-globals` в domain запрещает
 * `Date.now()`/`new Date()` в production-коде (Ж8 §2.6) — здесь это не
 * системные часы, а литерал-фикстура.
 */
import { describe, expect, it } from 'vitest'
import { OtpCode, OTP_TTL_SECONDS } from './otp-code.vo.js'
import { type Clock } from '@/shared-kernel/index.js'

class FixedClock implements Clock {
  constructor(private readonly nowDate: Date) {}
  now(): Date {
    return this.nowDate
  }
}

// eslint-disable-next-line no-restricted-globals -- тестовая фикстура: литерал даты
const START = new Date('2026-08-28T10:00:00.000Z')
const ONE_SECOND_MS = 1000

describe('OtpCode (DTJ-010, SRS-DOM-069)', () => {
  it('issue фиксирует хеш + issuedAt + expiresAt = now + TTL', () => {
    const clock = new FixedClock(START)
    const code = OtpCode.issue({ codeHash: 'hash', subjectRef: '+992917123456', clock })
    expect(code.codeHash).toBe('hash')
    expect(code.subjectRef).toBe('+992917123456')
    expect(code.issuedAt).toEqual(START)
    // eslint-disable-next-line no-restricted-globals -- тестовая фикстура: вычисление ожидаемого expiresAt
    const expectedExpiry = new Date(START.getTime() + OTP_TTL_SECONDS * ONE_SECOND_MS)
    expect(code.expiresAt).toEqual(expectedExpiry)
  })

  it('isExpired: false в TTL, true после TTL', () => {
    const code = OtpCode.issue({ codeHash: 'h', subjectRef: 'r', clock: new FixedClock(START) })
    expect(code.isExpired(new FixedClock(START))).toBe(false)
    // eslint-disable-next-line no-restricted-globals -- тестовая фикстура: момент за пределами TTL
    const pastClock = new FixedClock(new Date(START.getTime() + (OTP_TTL_SECONDS + 1) * ONE_SECOND_MS))
    expect(code.isExpired(pastClock)).toBe(true)
  })

  it('restore: возвращает VO с теми же полями', () => {
    // eslint-disable-next-line no-restricted-globals -- тестовая фикстура: момент +1 секунда
    const expiresAt = new Date(START.getTime() + ONE_SECOND_MS)
    const restored = OtpCode.restore({
      codeHash: 'h',
      subjectRef: 'r',
      issuedAt: START,
      expiresAt,
    })
    expect(restored.codeHash).toBe('h')
    expect(restored.subjectRef).toBe('r')
    expect(restored.issuedAt).toEqual(START)
  })
})
