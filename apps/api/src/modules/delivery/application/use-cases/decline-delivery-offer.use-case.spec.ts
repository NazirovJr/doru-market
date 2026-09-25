import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/index.js'
import { Courier } from '../../domain/courier.entity.js'
import { DeliveryOffer } from '../../domain/delivery-offer.entity.js'
import type { DeliveryOfferRepositoryPort } from '../ports/delivery-offer.repository.port.js'
import type { CourierRepositoryPort } from '../ports/courier.repository.port.js'
import type { DeliveryUnitOfWorkPort } from '../ports/delivery-unit-of-work.port.js'
import type { EscalateDeliveryOfferService } from '../services/escalate-delivery-offer.service.js'
import { DeclineDeliveryOfferUseCase } from './decline-delivery-offer.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')
const OFFER_ID = 'offer-1'
const ASSIGNMENT_ID = 'assignment-1'
const COURIER_ID = 'courier-1'
const USER_ID = 'user-1'

function makeOffer(courierId = COURIER_ID): DeliveryOffer {
  return DeliveryOffer.create({
    id: OFFER_ID,
    deliveryAssignmentId: ASSIGNMENT_ID,
    courierId,
    sequenceNo: 1,
    distanceMeters: 500,
    score: 0.8,
    offeredAt: NOW,
    expiresAt: new Date(NOW.getTime() + 45_000),
  })
}

function makeCourier(): Courier {
  return Courier.create({ id: COURIER_ID, userId: USER_ID, chainId: null, taxStatus: 'individual_patent', vehicleType: 'car', now: NOW })
}

function makeFakeEscalate(execute: EscalateDeliveryOfferService['execute'] = vi.fn().mockResolvedValue(undefined)): EscalateDeliveryOfferService {
  return { execute } as unknown as EscalateDeliveryOfferService
}

interface Harness {
  readonly useCase: DeclineDeliveryOfferUseCase
  readonly offersSave: ReturnType<typeof vi.fn>
  readonly escalateExecute: ReturnType<typeof vi.fn>
}

function makeUseCase(params: { offer?: DeliveryOffer | null; courier?: Courier | null } = {}): Harness {
  const offersSave = vi.fn().mockResolvedValue(undefined)
  const offers: DeliveryOfferRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByIdForUpdate: vi.fn().mockResolvedValue(params.offer === undefined ? makeOffer() : params.offer),
    findPendingByCourierId: vi.fn().mockResolvedValue([]),
    findByAssignmentId: vi.fn().mockResolvedValue([]),
    save: offersSave,
  }
  const couriers: CourierRepositoryPort = {
    findById: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(params.courier === undefined ? makeCourier() : params.courier),
    save: vi.fn().mockResolvedValue(undefined),
  }
  const uow: DeliveryUnitOfWorkPort = { run: async (cb) => cb(undefined) }
  const escalateExecute = vi.fn().mockResolvedValue(undefined)
  const clock: Clock = { now: () => NOW }
  return {
    useCase: new DeclineDeliveryOfferUseCase(offers, couriers, uow, makeFakeEscalate(escalateExecute), clock),
    offersSave,
    escalateExecute,
  }
}

describe('DeclineDeliveryOfferUseCase', () => {
  it('SRS-DELIV-014: pending + принадлежит актору -> status=declined, эскалация вызвана с deliveryAssignmentId', async () => {
    const { useCase, offersSave, escalateExecute } = makeUseCase()

    await useCase.execute({ offerId: OFFER_ID, userId: USER_ID, reason: 'traffic' })

    const savedOffer = offersSave.mock.calls[0]?.[0] as DeliveryOffer
    expect(savedOffer.status).toBe('declined')
    expect(escalateExecute).toHaveBeenCalledWith(ASSIGNMENT_ID, undefined)
  })

  it('оффер адресован другому курьеру -> ForbiddenError, эскалация не вызывается', async () => {
    const { useCase, escalateExecute } = makeUseCase({ offer: makeOffer('other-courier') })

    await expect(useCase.execute({ offerId: OFFER_ID, userId: USER_ID, reason: null })).rejects.toBeInstanceOf(ForbiddenError)
    expect(escalateExecute).not.toHaveBeenCalled()
  })

  it('актор не найден как курьер -> NotFoundError', async () => {
    const { useCase } = makeUseCase({ courier: null })

    await expect(useCase.execute({ offerId: OFFER_ID, userId: USER_ID, reason: null })).rejects.toBeInstanceOf(NotFoundError)
  })
})
