import { ErrorCode } from '@dorutj/contracts'
import { isErr, isOk } from '@dorutj/domain-kernel'
import { describe, expect, it } from 'vitest'
import { GeoPoint } from './geo-point.vo.js'

describe('GeoPoint VO (DTJ-009, SRS-DOM-072/073)', () => {
  it('1. валидная пара (Душанбе) → ok', () => {
    const r = GeoPoint.create(38.5598, 68.787)
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.latitude).toBe(38.5598)
  })

  it('2. latitude=90 (граница) → ok', () => {
    const r = GeoPoint.create(90, 0)
    expect(isOk(r)).toBe(true)
  })

  it('3. latitude=-90 (граница) → ok', () => {
    const r = GeoPoint.create(-90, 0)
    expect(isOk(r)).toBe(true)
  })

  it('4. latitude=90.001 → InvalidCoordinatesError', () => {
    const r = GeoPoint.create(90.001, 0)
    expect(isErr(r)).toBe(true)
    if (!isErr(r)) return
    expect(r.error.code).toBe(ErrorCode.INVALID_COORDINATES)
  })

  it('5. longitude=181 → InvalidCoordinatesError', () => {
    const r = GeoPoint.create(0, 181)
    expect(isErr(r)).toBe(true)
  })

  it('6. NaN → InvalidCoordinatesError', () => {
    const r = GeoPoint.create(Number.NaN, 0)
    expect(isErr(r)).toBe(true)
  })

  it('7. isLikelyWithinTajikistan: Душанбе → true', () => {
    const r = GeoPoint.create(38.5598, 68.787)
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.isLikelyWithinTajikistan()).toBe(true)
  })

  it('8. isLikelyWithinTajikistan: Самарканд (Узбекистан) → false (мягко, не блокирует)', () => {
    const r = GeoPoint.create(39.6542, 66.9597)
    expect(isOk(r)).toBe(true)
    if (!isOk(r)) return
    expect(r.value.isLikelyWithinTajikistan()).toBe(false)
  })

  it('9. distanceTo: Душанбе ↔ Худжанд ≈ 205 км по прямой (с допуском ±5 км из-за точности формулы)', () => {
    const dushanbe = GeoPoint.create(38.5598, 68.787)
    const khujand = GeoPoint.create(40.2895, 69.6222)
    expect(isOk(dushanbe)).toBe(true)
    expect(isOk(khujand)).toBe(true)
    if (!isOk(dushanbe) || !isOk(khujand)) return
    const distance = dushanbe.value.distanceTo(khujand.value)
    // ~230 км — это ДОРОЖНОЕ расстояние (через тоннель Анзоб/перевалы);
    // `distanceTo` — geo-хаверсин «по прямой», ~205 км (проверено эталонной
    // реализацией haversine на этих же координатах). Старый диапазон
    // 225-240км не мог пройти НИ ПРИ КАКОЙ корректной формуле по прямой —
    // тест был неверен относительно того, что реализация должна считать.
    expect(distance).toBeGreaterThan(200_000)
    expect(distance).toBeLessThan(210_000)
  })
})
