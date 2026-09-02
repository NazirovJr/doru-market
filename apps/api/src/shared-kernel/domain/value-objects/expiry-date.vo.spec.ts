import { ErrorCode } from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { describe, expect, it } from 'vitest'
import { fixedDate } from '../../testing/fixtures/fixed-date.fixture.js'
import { ExpiryDate } from './expiry-date.vo.js'

describe('ExpiryDate VO (DTJ-011, SRS-DOM-087/088)', () => {
  it('1. parse валидного "2026-08-27" → ok', () => {
    const r = ExpiryDate.parse('2026-08-27')
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.isoDate).toBe('2026-08-27')
  })

  it('2. parse невалидного формата → err(VALIDATION_ERROR)', () => {
    const r = ExpiryDate.parse('2026/08/27')
    expect(isErr(r)).toBe(true)
    if (!isErr(r)) return
    expect(r.error.code).toBe(ErrorCode.VALIDATION_ERROR)
  })

  it('3. isSellable: товар с expiry 2026-08-27 при today 2026-08-27 → false (включительно)', () => {
    const exp = ExpiryDate.parse('2026-08-27')
    expect(isOk(exp)).toBe(true)
    if (!isOk(exp)) return
    expect(exp.value.isSellable(fixedDate('2026-08-27T00:00:00.000Z'))).toBe(false)
  })

  it('4. isSellable: товар с expiry 2026-08-28 при today 2026-08-27 → true (день после)', () => {
    const exp = ExpiryDate.parse('2026-08-28')
    expect(isOk(exp)).toBe(true)
    if (!isOk(exp)) return
    expect(exp.value.isSellable(fixedDate('2026-08-27T00:00:00.000Z'))).toBe(true)
  })

  it('5. isSellable: товар с expiry 2026-08-26 при today 2026-08-27 → false (вчера истёк)', () => {
    const exp = ExpiryDate.parse('2026-08-26')
    expect(isOk(exp)).toBe(true)
    if (!isOk(exp)) return
    expect(exp.value.isSellable(fixedDate('2026-08-27T00:00:00.000Z'))).toBe(false)
  })

  it('6. hasMinimumRemainingShelfLife: 30 дней запаса при minDays=30 → true', () => {
    const exp = ExpiryDate.parse('2026-09-26')
    expect(isOk(exp)).toBe(true)
    if (!isOk(exp)) return
    expect(exp.value.hasMinimumRemainingShelfLife(fixedDate('2026-08-27T00:00:00.000Z'), 30)).toBe(true)
  })

  it('7. hasMinimumRemainingShelfLife: 29 дней запаса при minDays=30 → false (мягкое правило)', () => {
    const exp = ExpiryDate.parse('2026-09-25')
    expect(isOk(exp)).toBe(true)
    if (!isOk(exp)) return
    expect(exp.value.hasMinimumRemainingShelfLife(fixedDate('2026-08-27T00:00:00.000Z'), 30)).toBe(false)
  })

  it('8. isSellable vs hasMinimumRemainingShelfLife: разные правила', () => {
    // Товар с expiry 2026-08-28 (1 день до today 2026-08-27): isSellable true,
    // но hasMinimumRemainingShelfLife(30) false.
    const exp = ExpiryDate.parse('2026-08-28')
    expect(isOk(exp)).toBe(true)
    if (!isOk(exp)) return
    const today = fixedDate('2026-08-27T00:00:00.000Z')
    expect(exp.value.isSellable(today)).toBe(true)
    expect(exp.value.hasMinimumRemainingShelfLife(today, 30)).toBe(false)
  })
})
