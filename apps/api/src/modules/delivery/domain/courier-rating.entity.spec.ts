import { describe, expect, it } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import { fixedDate } from '@/modules/delivery/testing/fixtures/fixed-date.fixture.js'
import { CourierRating } from './courier-rating.entity.js'

const NOW = fixedDate('2026-08-27T12:00:00.000Z')

function validCommand(overrides: Partial<Parameters<typeof CourierRating.create>[0]> = {}) {
  return {
    id: 'rating-1',
    orderId: 'order-1',
    courierId: 'courier-1',
    customerId: 'customer-1',
    rating: 5,
    comment: null,
    now: NOW,
    ...overrides,
  }
}

describe('CourierRating.create() — SRS-DELIV-007/032, TC-DELIV-032', () => {
  it('rating 1..5 — валидны, эмитируют CourierRatedEvent', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const courierRating = CourierRating.create(validCommand({ rating }))
      expect(courierRating.rating).toBe(rating)
      expect(courierRating.pullDomainEvents()).toEqual([
        { type: 'CourierRatedEvent', orderId: 'order-1', courierId: 'courier-1', rating },
      ])
    }
  })

  it('chk_courier_ratings_range: rating=0 → ValidationError', () => {
    expect(() => CourierRating.create(validCommand({ rating: 0 }))).toThrow(ValidationError)
  })

  it('chk_courier_ratings_range: rating=6 → ValidationError', () => {
    expect(() => CourierRating.create(validCommand({ rating: 6 }))).toThrow(ValidationError)
  })

  it('rating дробный → ValidationError', () => {
    expect(() => CourierRating.create(validCommand({ rating: 4.5 }))).toThrow(ValidationError)
  })

  it('comment опционален (null)', () => {
    const rating = CourierRating.create(validCommand({ comment: 'Great service' }))
    expect(rating.comment).toBe('Great service')
  })
})

describe('restore() — не эмитирует событие (не новое создание)', () => {
  it('pullDomainEvents() пуст после restore()', () => {
    const created = CourierRating.create(validCommand())
    const restored = CourierRating.restore(created.toSnapshot())
    expect(restored.pullDomainEvents()).toEqual([])
  })
})
