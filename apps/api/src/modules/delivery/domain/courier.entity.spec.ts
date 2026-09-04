import { describe, expect, it } from 'vitest'
import { NoActiveShiftError, ShiftAlreadyActiveError, ValidationError } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { fixedDate } from '@/modules/delivery/testing/fixtures/fixed-date.fixture.js'
import { Courier } from './courier.entity.js'

const NOW = fixedDate('2026-08-27T10:00:00.000Z')
const LATER = fixedDate('2026-08-27T10:05:00.000Z')
const EARLIER = fixedDate('2026-08-27T09:00:00.000Z')

function geoPoint(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

function freshCourier(): Courier {
  return Courier.create({
    id: 'courier-1',
    userId: 'user-1',
    chainId: null,
    taxStatus: 'individual_patent',
    vehicleType: 'car',
    now: NOW,
  })
}

describe('Courier.create()', () => {
  it('регистрация начинает pending_verification, off_shift, rating 5.00, cash 0', () => {
    const courier = freshCourier()
    expect(courier.status).toBe('pending_verification')
    expect(courier.shiftStatus).toBe('off_shift')
    expect(courier.ratingAvg).toBe(5)
    expect(courier.ratingCount).toBe(0)
    expect(courier.currentCashOnHandDiram.equals(Money.fromDiram(0n))).toBe(true)
    expect(courier.coldChainCertified).toBe(false)
  })
})

describe('updateLocation() — SRS-DELIV-027', () => {
  const point1 = geoPoint(38.57, 68.78)
  const point2 = geoPoint(38.58, 68.79)

  it('первая точка — принимается', () => {
    const courier = freshCourier().updateLocation({ point: point1, capturedAt: NOW })
    expect(courier.lastKnownLocation?.point.latitude).toBe(38.57)
  })

  it('более новая точка заменяет предыдущую', () => {
    const courier = freshCourier()
      .updateLocation({ point: point1, capturedAt: NOW })
      .updateLocation({ point: point2, capturedAt: LATER })
    expect(courier.lastKnownLocation?.point.latitude).toBe(38.58)
  })

  it('устаревшая (переупорядоченная) точка молча игнорируется, не ошибка', () => {
    const courier = freshCourier()
      .updateLocation({ point: point2, capturedAt: LATER })
      .updateLocation({ point: point1, capturedAt: EARLIER })
    expect(courier.lastKnownLocation?.point.latitude).toBe(38.58)
  })
})

describe('goOnShift()/goOffShift() — SRS-DELIV-028/029', () => {
  it('off_shift → on_shift', () => {
    const courier = freshCourier().goOnShift()
    expect(courier.shiftStatus).toBe('on_shift')
  })

  it('повторный goOnShift() → ShiftAlreadyActiveError', () => {
    const courier = freshCourier().goOnShift()
    expect(() => courier.goOnShift()).toThrow(ShiftAlreadyActiveError)
  })

  it('goOffShift() возвращает off_shift', () => {
    const courier = freshCourier().goOnShift().goOffShift()
    expect(courier.shiftStatus).toBe('off_shift')
  })
})

describe('addCashOnHand()/settleCashOnHand() — SRS-DELIV-021/029', () => {
  it('на смене — увеличивает остаток', () => {
    const courier = freshCourier().goOnShift().addCashOnHand(Money.fromDiram(6000n))
    expect(courier.currentCashOnHandDiram.diram).toBe(6000n)
  })

  it('вне смены → NoActiveShiftError', () => {
    const courier = freshCourier()
    expect(() => courier.addCashOnHand(Money.fromDiram(6000n))).toThrow(NoActiveShiftError)
  })

  it('settleCashOnHand() обнуляет остаток', () => {
    const courier = freshCourier().goOnShift().addCashOnHand(Money.fromDiram(6000n)).settleCashOnHand()
    expect(courier.currentCashOnHandDiram.diram).toBe(0n)
  })
})

describe('applyRating() — SRS-DELIV-007 скользящее среднее', () => {
  it('первая оценка 4 при дефолте 5.00/0 → avg=4, count=1', () => {
    const courier = freshCourier().applyRating(4)
    expect(courier.ratingAvg).toBe(4)
    expect(courier.ratingCount).toBe(1)
  })

  it('TC-DELIV-032-подобный: (5*1 + 3) / 2 = 4.00', () => {
    const courier = freshCourier().applyRating(5).applyRating(3)
    expect(courier.ratingAvg).toBe(4)
    expect(courier.ratingCount).toBe(2)
  })

  it('округление до 2 знаков: (5+5+4)/3 = 4.666... → 4.67', () => {
    const courier = freshCourier().applyRating(5).applyRating(5).applyRating(4)
    expect(courier.ratingAvg).toBe(4.67)
  })

  it('rating=0 → ValidationError', () => {
    expect(() => freshCourier().applyRating(0)).toThrow(ValidationError)
  })

  it('rating=6 → ValidationError', () => {
    expect(() => freshCourier().applyRating(6)).toThrow(ValidationError)
  })

  it('rating дробный → ValidationError', () => {
    expect(() => freshCourier().applyRating(4.5)).toThrow(ValidationError)
  })
})

describe('restore()', () => {
  it('восстанавливает сущность из props без повторной инициализации дефолтов', () => {
    const original = freshCourier().goOnShift()
    const restored = Courier.restore(original.props)
    expect(restored.chainId).toBeNull()
    expect(restored.shiftStatus).toBe('on_shift')
    expect(restored.props).toEqual(original.props)
  })
})

describe('toEligibilitySnapshot()', () => {
  it('маппит поля для DeliveryAssignment.assign()', () => {
    const courier = Courier.create({
      id: 'courier-2',
      userId: 'user-2',
      chainId: 'chain-x',
      taxStatus: 'chain_employee',
      vehicleType: 'moped',
      now: NOW,
    })
    expect(courier.toEligibilitySnapshot()).toEqual({
      courierId: 'courier-2',
      courierChainId: 'chain-x',
      coldChainCertified: false,
    })
  })
})
