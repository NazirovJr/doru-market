import { describe, expect, it } from 'vitest'
import { OfferAlreadyRespondedError, OfferExpiredError, ValidationError } from '@dorutj/contracts'
import { fixedDate } from '@/modules/delivery/testing/fixtures/fixed-date.fixture.js'
import { DeliveryOffer } from './delivery-offer.entity.js'

const OFFERED_AT = fixedDate('2026-08-27T09:16:00.000Z')
const EXPIRES_AT = fixedDate('2026-08-27T09:16:45.000Z')
const BEFORE_EXPIRY = fixedDate('2026-08-27T09:16:30.000Z')
const AFTER_EXPIRY = fixedDate('2026-08-27T09:17:00.000Z')

function pendingOffer(): DeliveryOffer {
  return DeliveryOffer.create({
    id: 'offer-1',
    deliveryAssignmentId: 'assignment-1',
    courierId: 'courier-1',
    sequenceNo: 1,
    distanceMeters: 1840,
    score: 0.85,
    offeredAt: OFFERED_AT,
    expiresAt: EXPIRES_AT,
  })
}

describe('DeliveryOffer.create()', () => {
  it('валидная команда → status=pending, эмитирует DeliveryOfferCreatedEvent', () => {
    const offer = pendingOffer()
    expect(offer.status).toBe('pending')
    expect(offer.pullDomainEvents()).toEqual([
      {
        type: 'DeliveryOfferCreatedEvent',
        offerId: 'offer-1',
        deliveryAssignmentId: 'assignment-1',
        courierId: 'courier-1',
        sequenceNo: 1,
        expiresAt: EXPIRES_AT,
      },
    ])
  })

  it('chk_delivery_offers_sequence_positive: sequenceNo=0 → ValidationError', () => {
    expect(() =>
      DeliveryOffer.create({
        id: 'offer-2',
        deliveryAssignmentId: 'assignment-1',
        courierId: 'courier-1',
        sequenceNo: 0,
        distanceMeters: 1000,
        score: 0.5,
        offeredAt: OFFERED_AT,
        expiresAt: EXPIRES_AT,
      }),
    ).toThrow(ValidationError)
  })
})

describe('accept() — TC-DELIV-001/002/003', () => {
  it('TC-DELIV-001: pending, до истечения → accepted', () => {
    const offer = pendingOffer()
    offer.accept(BEFORE_EXPIRY)
    expect(offer.status).toBe('accepted')
  })

  it('TC-DELIV-002: now > expiresAt (гонка) → OfferExpiredError', () => {
    const offer = pendingOffer()
    expect(() => { offer.accept(AFTER_EXPIRY); }).toThrow(OfferExpiredError)
  })

  it('TC-DELIV-003: уже declined → OfferAlreadyRespondedError', () => {
    const offer = pendingOffer()
    offer.decline(null, BEFORE_EXPIRY)
    expect(() => { offer.accept(BEFORE_EXPIRY); }).toThrow(OfferAlreadyRespondedError)
  })
})

describe('decline() — SRS-DELIV-014', () => {
  it('pending → declined, сохраняет reason', () => {
    const offer = pendingOffer()
    offer.decline('too far', BEFORE_EXPIRY)
    expect(offer.status).toBe('declined')
    expect(offer.toSnapshot().declineReason).toBe('too far')
  })

  it('reason опционален (null)', () => {
    const offer = pendingOffer()
    offer.decline(null, BEFORE_EXPIRY)
    expect(offer.toSnapshot().declineReason).toBeNull()
  })

  it('повторный decline() → OfferAlreadyRespondedError', () => {
    const offer = pendingOffer()
    offer.decline(null, BEFORE_EXPIRY)
    expect(() => { offer.decline(null, BEFORE_EXPIRY); }).toThrow(OfferAlreadyRespondedError)
  })
})

describe('expire() — SRS-DELIV-039 (BullMQ timeout job)', () => {
  it('pending → expired, эмитирует DeliveryOfferExpiredEvent', () => {
    const offer = pendingOffer()
    offer.expire(AFTER_EXPIRY)
    expect(offer.status).toBe('expired')
    expect(offer.pullDomainEvents().at(-1)).toEqual({
      type: 'DeliveryOfferExpiredEvent',
      offerId: 'offer-1',
      deliveryAssignmentId: 'assignment-1',
      courierId: 'courier-1',
    })
  })

  it('уже accepted (курьер успел ответить до срабатывания джобы) → OfferAlreadyRespondedError', () => {
    const offer = pendingOffer()
    offer.accept(BEFORE_EXPIRY)
    expect(() => { offer.expire(AFTER_EXPIRY); }).toThrow(OfferAlreadyRespondedError)
  })
})

describe('supersede() — SRS-DELIV-033 (assign-manual)', () => {
  it('pending → superseded', () => {
    const offer = pendingOffer()
    offer.supersede(BEFORE_EXPIRY)
    expect(offer.status).toBe('superseded')
  })

  it('уже отвечен → OfferAlreadyRespondedError', () => {
    const offer = pendingOffer()
    offer.accept(BEFORE_EXPIRY)
    expect(() => { offer.supersede(AFTER_EXPIRY); }).toThrow(OfferAlreadyRespondedError)
  })
})

describe('restore()/toSnapshot()', () => {
  it('round-trip сохраняет состояние', () => {
    const offer = pendingOffer()
    offer.accept(BEFORE_EXPIRY)
    const snapshot = offer.toSnapshot()
    expect(DeliveryOffer.restore(snapshot).toSnapshot()).toEqual(snapshot)
  })
})
