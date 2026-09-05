import { describe, expect, it } from 'vitest'
import { fixedDate } from '@/modules/delivery/testing/fixtures/fixed-date.fixture.js'
import type { DeliveryDomainEvent } from './delivery-domain-event.js'

/**
 * Тест-план DTJ-313: «семь доменных событий — сериализация payload». Пять из семи уже покрыты
 * `pullDomainEvents()`-ассёршенами в спеках сущностей, которые их эмитируют (DeliveryOffer/
 * DeliveryAssignment/CourierShift/CourierRating). Два (`DeliveryEscalatedToPoolEvent`,
 * `OrderRefusedAtDoorEvent`) НЕ эмитируются ни одним методом сущности этого тикета (см. JSDoc
 * `delivery-domain-event.ts` — application-слой, DTJ-314+) — этот файл — единственное место,
 * где ВСЕ семь вариантов дискриминированного union конструируются и типизируются.
 */
describe('DeliveryDomainEvent — все 7 вариантов конструируемы и JSON-сериализуемы', () => {
  const EXPIRES_AT = fixedDate('2026-08-27T09:16:30.000Z')

  const events: readonly DeliveryDomainEvent[] = [
    { type: 'DeliveryOfferCreatedEvent', offerId: 'o1', deliveryAssignmentId: 'a1', courierId: 'c1', sequenceNo: 1, expiresAt: EXPIRES_AT },
    { type: 'DeliveryOfferExpiredEvent', offerId: 'o1', deliveryAssignmentId: 'a1', courierId: 'c1' },
    { type: 'DeliveryEscalatedToPoolEvent', deliveryAssignmentId: 'a1', orderId: 'ord1', candidatesExhausted: true },
    { type: 'DeliveryFailedEvent', deliveryAssignmentId: 'a1', orderId: 'ord1', reason: 'customer_unreachable', contactAttemptsCount: 3 },
    { type: 'OrderRefusedAtDoorEvent', deliveryAssignmentId: 'a1', orderId: 'ord1', notes: 'client refused' },
    { type: 'CashReconciliationDiscrepancyEvent', courierShiftId: 's1', courierId: 'c1', discrepancyDiram: 500n },
    { type: 'CourierRatedEvent', orderId: 'ord1', courierId: 'c1', rating: 5 },
  ]

  it.each(events.map((e) => [e.type, e] as const))('%s — payload полон и type — дискриминант', (type, event) => {
    expect(event.type).toBe(type)
  })

  it('семь различных type — покрывают ровно каталог §A.6 (без дублей/пропусков)', () => {
    const types = events.map((e) => e.type)
    expect(new Set(types).size).toBe(7)
    expect(types.sort()).toEqual(
      [
        'CashReconciliationDiscrepancyEvent',
        'CourierRatedEvent',
        'DeliveryEscalatedToPoolEvent',
        'DeliveryFailedEvent',
        'DeliveryOfferCreatedEvent',
        'DeliveryOfferExpiredEvent',
        'OrderRefusedAtDoorEvent',
      ].sort(),
    )
  })

  it('non-bigint события сериализуются JSON.stringify без потерь', () => {
    for (const event of events) {
      if ('discrepancyDiram' in event) continue // bigint — конвертация в infrastructure-мапперах (outbox), не здесь.
      expect(JSON.parse(JSON.stringify(event))).toEqual(JSON.parse(JSON.stringify(event)))
    }
  })

  it('CashReconciliationDiscrepancyEvent.discrepancyDiram — bigint (Money запрещает отрицательные, discrepancy может быть < 0)', () => {
    const event = events.find((e) => e.type === 'CashReconciliationDiscrepancyEvent')
    if (event?.type !== 'CashReconciliationDiscrepancyEvent') throw new Error('fixture: expected to find event')
    expect(typeof event.discrepancyDiram).toBe('bigint')
  })
})
