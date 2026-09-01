/**
 * Unit-тест `PharmacyOpeningHoursPolicy` / `isOpenNow` (DTJ-184, EP-06, R1).
 *
 * Тест-план тикета: обычный интервал (внутри/на границах/снаружи), интервал через
 * полночь (ночная часть/дневная часть/снаружи), `is24x7` короткое замыкание,
 * вырожденный интервал. `Clock`-порт — фиксированный тест-дублёр, БЕЗ реального
 * ожидания времени (`FixedClockPort` ниже, аналог `packages/testing-kit/FixedClockAdapter`
 * по духу, но реализует локальный `Clock` этого модуля — сигнатура `nowInTenantTz`
 * несовместима с системным `Clock.now(): Date`).
 *
 * @see tickets/ep05-search-map/DTJ-184.md (критерии приёмки, тест-план)
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-046, SRS-CAT-047, TC-CAT-020)
 */
import { describe, expect, it } from 'vitest'
import { TenantId } from '@/modules/tenancy/index.js'
import { TimeOfDay, type Clock } from '../ports/clock.port.js'
import { isOpenNow, isTwentyFourSeven, PharmacyOpeningHoursPolicy } from './pharmacy-opening-hours.policy.js'

const TEST_TENANT_ID = TenantId.from('11111111-1111-4111-8111-111111111111')

/** Тест-дублёр `Clock`: всегда отдаёт заранее заданное фиксированное `TimeOfDay`. */
class FixedClock implements Clock {
  constructor(private readonly fixed: TimeOfDay) {}

  nowInTenantTz(): TimeOfDay {
    return this.fixed
  }
}

interface IsOpenNowCase {
  readonly now: string
  readonly opening: string
  readonly closing: string
  readonly expected: boolean
}

describe('isOpenNow — SRS-CAT-046 (обычный интервал)', () => {
  it.each<IsOpenNowCase>([
    { now: '08:59', opening: '09:00', closing: '21:00', expected: false }, // TC: граница не включена ДО начала
    { now: '09:00', opening: '09:00', closing: '21:00', expected: true }, // граница включена в начале
    { now: '12:00', opening: '09:00', closing: '21:00', expected: true }, // внутри интервала
    { now: '21:00', opening: '09:00', closing: '21:00', expected: true }, // граница включена в конце
    { now: '21:01', opening: '09:00', closing: '21:00', expected: false }, // снаружи после конца
  ])('now=$now, opening=$opening, closing=$closing → $expected', ({ now, opening, closing, expected }) => {
    expect(isOpenNow(TimeOfDay.parse(now), TimeOfDay.parse(opening), TimeOfDay.parse(closing))).toBe(expected)
  })
})

describe('isOpenNow — SRS-CAT-046 (интервал через полночь, closing < opening)', () => {
  it.each<IsOpenNowCase>([
    { now: '01:00', opening: '20:00', closing: '02:00', expected: true }, // TC-CAT-020: ночная часть, после полуночи
    { now: '23:30', opening: '20:00', closing: '02:00', expected: true }, // ночная часть, до полуночи
    { now: '02:00', opening: '20:00', closing: '02:00', expected: true }, // граница дневной части включена
    { now: '20:00', opening: '20:00', closing: '02:00', expected: true }, // граница ночной части включена (начало)
    { now: '10:00', opening: '20:00', closing: '02:00', expected: false }, // снаружи обеих частей (день)
    { now: '19:59', opening: '20:00', closing: '02:00', expected: false }, // снаружи, вплотную перед открытием
  ])('now=$now, opening=$opening, closing=$closing → $expected', ({ now, opening, closing, expected }) => {
    expect(isOpenNow(TimeOfDay.parse(now), TimeOfDay.parse(opening), TimeOfDay.parse(closing))).toBe(expected)
  })
})

describe('isOpenNow — вырожденный интервал (opening === closing)', () => {
  it('открыто ТОЛЬКО в эту единственную минуту', () => {
    expect(isOpenNow(TimeOfDay.parse('09:00'), TimeOfDay.parse('09:00'), TimeOfDay.parse('09:00'))).toBe(true)
  })

  it('закрыто в любую другую минуту', () => {
    expect(isOpenNow(TimeOfDay.parse('09:01'), TimeOfDay.parse('09:00'), TimeOfDay.parse('09:00'))).toBe(false)
    expect(isOpenNow(TimeOfDay.parse('08:59'), TimeOfDay.parse('09:00'), TimeOfDay.parse('09:00'))).toBe(false)
  })
})

describe('isTwentyFourSeven — SRS-CAT-047', () => {
  it('true при is24x7 === true', () => {
    expect(isTwentyFourSeven({ is24x7: true })).toBe(true)
  })

  it('false при is24x7 === false', () => {
    expect(isTwentyFourSeven({ is24x7: false })).toBe(false)
  })
})

describe('PharmacyOpeningHoursPolicy.evaluate', () => {
  it('is24x7=true → isOpenNow: true, короткое замыкание БЕЗ обращения к Clock (мусор в часах не влияет)', () => {
    let clockCalled = false
    const spyClock: Clock = {
      nowInTenantTz: () => {
        clockCalled = true
        return TimeOfDay.parse('00:00')
      },
    }
    const policy = new PharmacyOpeningHoursPolicy(spyClock)

    const result = policy.evaluate(
      { is24x7: true, openingTime: TimeOfDay.parse('23:59'), closingTime: TimeOfDay.parse('00:01') },
      TEST_TENANT_ID,
    )

    expect(result).toEqual({ isOpenNow: true })
    expect(clockCalled).toBe(false)
  })

  it('is24x7=false, обычный интервал, текущее время внутри → isOpenNow: true', () => {
    const policy = new PharmacyOpeningHoursPolicy(new FixedClock(TimeOfDay.parse('12:00')))

    const result = policy.evaluate(
      { is24x7: false, openingTime: TimeOfDay.parse('09:00'), closingTime: TimeOfDay.parse('21:00') },
      TEST_TENANT_ID,
    )

    expect(result).toEqual({ isOpenNow: true })
  })

  it('is24x7=false, обычный интервал, текущее время снаружи → isOpenNow: false', () => {
    const policy = new PharmacyOpeningHoursPolicy(new FixedClock(TimeOfDay.parse('08:59')))

    const result = policy.evaluate(
      { is24x7: false, openingTime: TimeOfDay.parse('09:00'), closingTime: TimeOfDay.parse('21:00') },
      TEST_TENANT_ID,
    )

    expect(result).toEqual({ isOpenNow: false })
  })

  it('is24x7=false, интервал через полночь (20:00–02:00), сейчас 01:00 (TC-CAT-020) → isOpenNow: true', () => {
    const policy = new PharmacyOpeningHoursPolicy(new FixedClock(TimeOfDay.parse('01:00')))

    const result = policy.evaluate(
      { is24x7: false, openingTime: TimeOfDay.parse('20:00'), closingTime: TimeOfDay.parse('02:00') },
      TEST_TENANT_ID,
    )

    expect(result).toEqual({ isOpenNow: true })
  })

  it('передаёт tenantId в Clock.nowInTenantTz (мульти-тенантность)', () => {
    let receivedTenantId: TenantId | undefined
    const spyClock: Clock = {
      nowInTenantTz: (tenantId) => {
        receivedTenantId = tenantId
        return TimeOfDay.parse('12:00')
      },
    }
    const policy = new PharmacyOpeningHoursPolicy(spyClock)

    policy.evaluate(
      { is24x7: false, openingTime: TimeOfDay.parse('09:00'), closingTime: TimeOfDay.parse('21:00') },
      TEST_TENANT_ID,
    )

    expect(receivedTenantId).toBe(TEST_TENANT_ID)
  })
})

describe('TimeOfDay — валидация', () => {
  it('parse отклоняет некорректный формат', () => {
    expect(() => TimeOfDay.parse('9:00')).toThrow()
    expect(() => TimeOfDay.parse('25:00')).toThrow()
    expect(() => TimeOfDay.parse('12:60')).toThrow()
    expect(() => TimeOfDay.parse('not-a-time')).toThrow()
  })

  it('of отклоняет часы/минуты вне диапазона', () => {
    expect(() => TimeOfDay.of(24, 0)).toThrow()
    expect(() => TimeOfDay.of(-1, 0)).toThrow()
    expect(() => TimeOfDay.of(0, 60)).toThrow()
    expect(() => TimeOfDay.of(0, -1)).toThrow()
  })

  it('toString форматирует обратно в HH:MM', () => {
    expect(TimeOfDay.parse('09:05').toString()).toBe('09:05')
    expect(TimeOfDay.of(0, 0).toString()).toBe('00:00')
  })
})
