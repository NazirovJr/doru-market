import { describe, expect, it } from 'vitest'
import { computeAnalogSavingsDiram } from './analog-savings-calculator.service.js'

describe('computeAnalogSavingsDiram (DTJ-385)', () => {
  it('референс дороже аналога — положительная разница в целых дирамах', () => {
    expect(computeAnalogSavingsDiram(3000, 1800)).toBe(1200)
  })

  it('равные цены — null', () => {
    expect(computeAnalogSavingsDiram(1000, 1000)).toBeNull()
  })

  it('аналог дороже референса — null', () => {
    expect(computeAnalogSavingsDiram(1000, 1800)).toBeNull()
  })

  it('нет цены у референса — null', () => {
    expect(computeAnalogSavingsDiram(null, 1000)).toBeNull()
  })

  it('нет цены у аналога — null', () => {
    expect(computeAnalogSavingsDiram(3000, null)).toBeNull()
  })

  it('нет цены у обеих сторон — null', () => {
    expect(computeAnalogSavingsDiram(null, null)).toBeNull()
  })
})
