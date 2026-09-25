import { describe, expect, it, vi } from 'vitest'
import type { Clock } from '@/shared-kernel/index.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import type { DeliveryOutboxPort } from '../ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { EscalateDeliveryOfferService } from '../services/escalate-delivery-offer.service.js'
import { ResolveDeliveryOfferTimeoutUseCase } from './resolve-delivery-offer-timeout.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const OFFER_ID = 'offer-1'
const ASSIGNMENT_ID = 'assignment-1'

function makeOffer(): DeliveryOffer {
  const offer = DeliveryOffer.create({
    id: OFFER_ID,
    deliveryAssignmentId: ASSIGNMENT_ID,
    courierId: 'courier-1',
    sequenceNo: 1,
    distanceMeters: 500,
    score: 0.8,
    offeredAt: NOW,
    expiresAt: new Date(NOW.getTime() - 1000), // уже истёк — таймер и сработал
  })
  offer.pullDomainEvents() // как из БД: CreatedEvent уже опубликован ранее, при создании
  return offer
}

function makeFakeEscalate(execute: EscalateDeliveryOfferService['execute'] = vi.fn().mockResolvedValue(undefined)): EscalateDeliveryOfferService {
  return { execute } as unknown as EscalateDeliveryOfferService
}

describe('ResolveDeliveryOfferTimeoutUseCase', () => {
  it('SRS-DELIV-039: оффер всё ещё pending -> status=expired, DeliveryOfferExpiredEvent опубликовано, эскалация вызвана', async () => {
    const offersSave = vi.fn().mockResolvedValue(undefined)
    const outboxAppend = vi.fn().mockResolvedValue(undefined)
    const escalateExecute = vi.fn().mockResolvedValue(undefined)
    const offers: DeliveryOfferRepositoryPort = {
      findById: vi.fn().mockResolvedValue(null),
      findByIdForUpdate: vi.fn().mockResolvedValue(makeOffer()),
      findPendingByCourierId: vi.fn().mockResolvedValue([]),
      findByAssignmentId: vi.fn().mockResolvedValue([]),
      save: offersSave,
    }
    const outbox: DeliveryOutboxPort = { append: outboxAppend }
    const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
    const clock: Clock = { now: () => NOW }
    const useCase = new ResolveDeliveryOfferTimeoutUseCase(offers, outbox, uow, makeFakeEscalate(escalateExecute), clock)

    await useCase.execute({ offerId: OFFER_ID })

    const savedOffer = offersSave.mock.calls[0]?.[0] as DeliveryOffer
    expect(savedOffer.status).toBe('expired')
    expect(outboxAppend).toHaveBeenCalledTimes(1)
    const [publishedEvent] = outboxAppend.mock.calls[0] as [unknown]
    expect(publishedEvent).toMatchObject({ type: 'DeliveryOfferExpiredEvent', offerId: OFFER_ID })
    expect(escalateExecute).toHaveBeenCalledWith(ASSIGNMENT_ID, undefined)
  })

  it('SRS-DELIV-039: оффер УЖЕ не pending (ответили раньше таймера) -> idempotent no-op, эскалация не вызывается', async () => {
    const offer = makeOffer()
    offer.decline(null, NOW)
    const offersSave = vi.fn().mockResolvedValue(undefined)
    const escalateExecute = vi.fn().mockResolvedValue(undefined)
    const offers: DeliveryOfferRepositoryPort = {
      findById: vi.fn().mockResolvedValue(null),
      findByIdForUpdate: vi.fn().mockResolvedValue(offer),
      findPendingByCourierId: vi.fn().mockResolvedValue([]),
      findByAssignmentId: vi.fn().mockResolvedValue([]),
      save: offersSave,
    }
    const outbox: DeliveryOutboxPort = { append: vi.fn() }
    const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
    const clock: Clock = { now: () => NOW }
    const useCase = new ResolveDeliveryOfferTimeoutUseCase(offers, outbox, uow, makeFakeEscalate(escalateExecute), clock)

    await useCase.execute({ offerId: OFFER_ID })

    expect(offersSave).not.toHaveBeenCalled()
    expect(escalateExecute).not.toHaveBeenCalled()
  })

  it('оффер не найден (удалён/некорректный jobId) -> idempotent no-op, не бросает', async () => {
    const offers: DeliveryOfferRepositoryPort = {
      findById: vi.fn().mockResolvedValue(null),
      findByIdForUpdate: vi.fn().mockResolvedValue(null),
      findPendingByCourierId: vi.fn().mockResolvedValue([]),
      findByAssignmentId: vi.fn().mockResolvedValue([]),
      save: vi.fn(),
    }
    const outbox: DeliveryOutboxPort = { append: vi.fn() }
    const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
    const clock: Clock = { now: () => NOW }
    const useCase = new ResolveDeliveryOfferTimeoutUseCase(offers, outbox, uow, makeFakeEscalate(), clock)

    await expect(useCase.execute({ offerId: OFFER_ID })).resolves.toBeUndefined()
  })
})
