import { describe, expect, it, vi } from 'vitest'
import { InternalServerErrorException } from '@nestjs/common'
import type { JwtClaims } from '@/modules/auth/index.js'
import type { SubmitCourierRatingUseCase } from '../application/use-cases/submit-courier-rating.use-case.js'
import { CourierRatingsController } from './courier-ratings.controller.js'

const CUSTOMER_CLAIMS: JwtClaims = { sub: 'customer-1', role: 'customer', tenantId: 'tenant-1', pharmacyId: null, chainId: null, sessionId: 's-1' }

function fakeUseCase(): { useCase: SubmitCourierRatingUseCase; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue({
    id: 'rating-1',
    orderId: 'order-1',
    courierId: 'courier-1',
    customerId: 'customer-1',
    rating: 5,
    comment: null,
    createdAt: new Date('2026-09-06T10:00:00.000Z'),
  })
  return { useCase: { execute } as unknown as SubmitCourierRatingUseCase, execute }
}

describe('CourierRatingsController', () => {
  it('create: передаёт tenantId/customerId(из JWT)/orderId/rating/comment в use case, отвечает 200 с созданной оценкой', async () => {
    const { useCase, execute } = fakeUseCase()
    const controller = new CourierRatingsController(useCase)

    const response = await controller.create(CUSTOMER_CLAIMS, { orderId: 'order-1', rating: 5, comment: 'great' })

    expect(execute).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      customerId: 'customer-1',
      orderId: 'order-1',
      rating: 5,
      comment: 'great',
    })
    expect(response.data.id).toBe('rating-1')
  })

  it('comment отсутствует в теле -> передаётся null (не undefined)', async () => {
    const { useCase, execute } = fakeUseCase()
    const controller = new CourierRatingsController(useCase)

    await controller.create(CUSTOMER_CLAIMS, { orderId: 'order-1', rating: 4 })

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ comment: null }))
  })

  it('claims.tenantId === null (не должно быть достижимо — customer всегда тенант-скоуп) -> InternalServerErrorException', async () => {
    const { useCase } = fakeUseCase()
    const controller = new CourierRatingsController(useCase)
    const brokenClaims: JwtClaims = { ...CUSTOMER_CLAIMS, tenantId: null }

    await expect(controller.create(brokenClaims, { orderId: 'order-1', rating: 5 })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    )
  })
})
