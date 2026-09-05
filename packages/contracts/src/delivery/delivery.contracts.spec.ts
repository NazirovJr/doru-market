import { describe, expect, it } from 'vitest'
import {
  assignManualRequestSchema,
  courierLocationRequestSchema,
  createCourierRatingRequestSchema,
  createDeliveryZoneRequestSchema,
  declineDeliveryOfferRequestSchema,
  deliverRequestSchema,
  departToCustomerRequestSchema,
  endCourierShiftRequestSchema,
  markDeliveryFailedRequestSchema,
  putDeliveryPricingRuleRequestSchema,
  reassignDeliveryAssignmentRequestSchema,
  recordCashRequestSchema,
  refuseAtDoorRequestSchema,
  reportDeliveryIssueRequestSchema,
  updateDeliveryZoneRequestSchema,
} from './delivery.contracts.js'

const VALID_COURIER_ID = '11111111-1111-4111-8111-111111111111'
const VALID_ORDER_ID = '22222222-2222-4222-8222-222222222222'

describe('declineDeliveryOfferRequestSchema (SRS-DELIV-014)', () => {
  it('reason опционален', () => {
    expect(declineDeliveryOfferRequestSchema.parse({})).toEqual({})
  })
  it('принимает reason в пределах лимита', () => {
    expect(declineDeliveryOfferRequestSchema.parse({ reason: 'too far' }).reason).toBe('too far')
  })
  it('отклоняет reason длиннее 100 символов', () => {
    expect(declineDeliveryOfferRequestSchema.safeParse({ reason: 'x'.repeat(101) }).success).toBe(false)
  })
})

describe('assignManualRequestSchema / reassignDeliveryAssignmentRequestSchema (SRS-DELIV-033/034)', () => {
  it('assign-manual: reason опционален', () => {
    expect(assignManualRequestSchema.parse({ courierId: VALID_COURIER_ID }).reason).toBeUndefined()
  })
  it('reassign: reason ОБЯЗАТЕЛЕН — отклоняет отсутствие reason', () => {
    expect(reassignDeliveryAssignmentRequestSchema.safeParse({ courierId: VALID_COURIER_ID }).success).toBe(false)
  })
  it('reassign: отклоняет пустую строку reason', () => {
    expect(
      reassignDeliveryAssignmentRequestSchema.safeParse({ courierId: VALID_COURIER_ID, reason: '' }).success,
    ).toBe(false)
  })
  it('reassign: принимает валидный courierId+reason', () => {
    const parsed = reassignDeliveryAssignmentRequestSchema.parse({ courierId: VALID_COURIER_ID, reason: 'SLA breach' })
    expect(parsed).toEqual({ courierId: VALID_COURIER_ID, reason: 'SLA breach' })
  })
  it('отклоняет courierId, не являющийся UUID', () => {
    expect(assignManualRequestSchema.safeParse({ courierId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('departToCustomerRequestSchema (SRS-DELIV-020)', () => {
  it('coldChainBagConfirmed опционален', () => {
    expect(departToCustomerRequestSchema.parse({})).toEqual({})
  })
  it('принимает true/false', () => {
    expect(departToCustomerRequestSchema.parse({ coldChainBagConfirmed: true }).coldChainBagConfirmed).toBe(true)
  })
})

describe('recordCashRequestSchema (SRS-DELIV-021)', () => {
  it('принимает целые неотрицательные суммы', () => {
    const parsed = recordCashRequestSchema.parse({ collectedDiram: 6000, changeDiram: 0 })
    expect(parsed).toEqual({ collectedDiram: 6000, changeDiram: 0 })
  })
  it('отклоняет отрицательную сумму', () => {
    expect(recordCashRequestSchema.safeParse({ collectedDiram: -1, changeDiram: 0 }).success).toBe(false)
  })
  it('отклоняет дробную сумму (не целое число дирамов)', () => {
    expect(recordCashRequestSchema.safeParse({ collectedDiram: 100.5, changeDiram: 0 }).success).toBe(false)
  })
})

describe('deliverRequestSchema (SRS-DELIV-022/024)', () => {
  it('принимает ровно 4-значный otpCode', () => {
    expect(deliverRequestSchema.parse({ otpCode: '1234' }).otpCode).toBe('1234')
  })
  it('отклоняет otpCode другой длины', () => {
    expect(deliverRequestSchema.safeParse({ otpCode: '12345' }).success).toBe(false)
    expect(deliverRequestSchema.safeParse({ otpCode: '123' }).success).toBe(false)
  })
  it('отклоняет нечисловой otpCode', () => {
    expect(deliverRequestSchema.safeParse({ otpCode: 'abcd' }).success).toBe(false)
  })
  it('proofPhotoUrl опционален, но должен быть валидным URL', () => {
    expect(deliverRequestSchema.parse({ otpCode: '1234' }).proofPhotoUrl).toBeUndefined()
    expect(deliverRequestSchema.safeParse({ otpCode: '1234', proofPhotoUrl: 'not-a-url' }).success).toBe(false)
  })
})

describe('reportDeliveryIssueRequestSchema (SRS-DELIV-025)', () => {
  it('принимает все три issueType', () => {
    for (const issueType of ['customer_unreachable', 'address_not_found', 'other'] as const) {
      expect(reportDeliveryIssueRequestSchema.parse({ issueType }).issueType).toBe(issueType)
    }
  })
  it('отклоняет неизвестный issueType', () => {
    expect(reportDeliveryIssueRequestSchema.safeParse({ issueType: 'gremlins' }).success).toBe(false)
  })
})

describe('markDeliveryFailedRequestSchema (SRS-DELIV-025/SRS-DOM-143)', () => {
  it('принимает customer_unreachable/address_not_found', () => {
    expect(markDeliveryFailedRequestSchema.parse({ reason: 'customer_unreachable' }).reason).toBe(
      'customer_unreachable',
    )
  })
  it('отклоняет "other" — нет определённого пути эскалации через mark-failed', () => {
    expect(markDeliveryFailedRequestSchema.safeParse({ reason: 'other' }).success).toBe(false)
  })
})

describe('refuseAtDoorRequestSchema (SRS-DELIV-026)', () => {
  it('reason — фиксированный литерал refused_at_door', () => {
    expect(refuseAtDoorRequestSchema.parse({ reason: 'refused_at_door' }).reason).toBe('refused_at_door')
  })
  it('отклоняет любое другое значение reason', () => {
    expect(refuseAtDoorRequestSchema.safeParse({ reason: 'customer_unreachable' }).success).toBe(false)
  })
})

describe('courierLocationRequestSchema (SRS-DELIV-027)', () => {
  const ping = { lat: 38.57, lon: 68.78, capturedAt: '2026-08-27T09:16:30.000Z' }

  it('принимает одиночный пинг', () => {
    expect(courierLocationRequestSchema.parse(ping)).toMatchObject({ lat: 38.57, lon: 68.78 })
  })
  it('принимает батч { pings: [...] }', () => {
    const parsed = courierLocationRequestSchema.parse({ pings: [ping, ping] })
    expect('pings' in parsed && parsed.pings).toHaveLength(2)
  })
  it('отклоняет пустой батч pings', () => {
    expect(courierLocationRequestSchema.safeParse({ pings: [] }).success).toBe(false)
  })
  it('отклоняет широту вне диапазона [-90,90]', () => {
    expect(courierLocationRequestSchema.safeParse({ ...ping, lat: 91 }).success).toBe(false)
  })
  it('отклоняет долготу вне диапазона [-180,180]', () => {
    expect(courierLocationRequestSchema.safeParse({ ...ping, lon: 181 }).success).toBe(false)
  })
})

describe('endCourierShiftRequestSchema (SRS-DELIV-029)', () => {
  it('принимает неотрицательный cashSubmittedDiram', () => {
    expect(endCourierShiftRequestSchema.parse({ cashSubmittedDiram: 9500 }).cashSubmittedDiram).toBe(9500)
  })
  it('отклоняет отрицательное значение', () => {
    expect(endCourierShiftRequestSchema.safeParse({ cashSubmittedDiram: -1 }).success).toBe(false)
  })
})

describe('createCourierRatingRequestSchema (SRS-DELIV-032)', () => {
  it('принимает rating 1..5', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(createCourierRatingRequestSchema.parse({ orderId: VALID_ORDER_ID, rating }).rating).toBe(rating)
    }
  })
  it('отклоняет rating вне 1..5', () => {
    expect(createCourierRatingRequestSchema.safeParse({ orderId: VALID_ORDER_ID, rating: 0 }).success).toBe(false)
    expect(createCourierRatingRequestSchema.safeParse({ orderId: VALID_ORDER_ID, rating: 6 }).success).toBe(false)
  })
  it('отклоняет дробный rating', () => {
    expect(createCourierRatingRequestSchema.safeParse({ orderId: VALID_ORDER_ID, rating: 4.5 }).success).toBe(false)
  })
})

describe('putDeliveryPricingRuleRequestSchema (SRS-DELIV-036/D.6)', () => {
  const base = { baseRateDiram: 1000, ratePerKmDiram: 200 }

  it('принимает минимальный валидный набор (дефолты для min/night-extra)', () => {
    const parsed = putDeliveryPricingRuleRequestSchema.parse(base)
    expect(parsed.minOrderAmountDiram).toBe(0)
    expect(parsed.nightTariffExtraDiram).toBe(0)
  })
  it('принимает оба поля ночного тарифа заданными одновременно', () => {
    const parsed = putDeliveryPricingRuleRequestSchema.parse({
      ...base,
      nightTariffStartTime: '22:00',
      nightTariffEndTime: '06:00',
      nightTariffExtraDiram: 1000,
    })
    expect(parsed.nightTariffStartTime).toBe('22:00')
  })
  it('отклоняет только ОДНУ границу ночного тарифа (обе должны быть заданы либо обе отсутствовать)', () => {
    expect(
      putDeliveryPricingRuleRequestSchema.safeParse({ ...base, nightTariffStartTime: '22:00' }).success,
    ).toBe(false)
  })
  it('отклоняет отрицательный baseRateDiram', () => {
    expect(putDeliveryPricingRuleRequestSchema.safeParse({ ...base, baseRateDiram: -1 }).success).toBe(false)
  })
})

describe('createDeliveryZoneRequestSchema / updateDeliveryZoneRequestSchema (D.6)', () => {
  it('create: применяет дефолты priority=0/isActive=true', () => {
    const parsed = createDeliveryZoneRequestSchema.parse({
      name: 'Zone A',
      centerLat: 38.57,
      centerLon: 68.78,
      radiusKm: 5,
    })
    expect(parsed.priority).toBe(0)
    expect(parsed.isActive).toBe(true)
  })
  it('create: отклоняет неположительный radiusKm', () => {
    expect(
      createDeliveryZoneRequestSchema.safeParse({ name: 'Z', centerLat: 0, centerLon: 0, radiusKm: 0 }).success,
    ).toBe(false)
  })
  it('update: все поля опциональны (частичное обновление)', () => {
    expect(updateDeliveryZoneRequestSchema.parse({})).toEqual({})
    expect(updateDeliveryZoneRequestSchema.parse({ isActive: false })).toEqual({ isActive: false })
  })
})
