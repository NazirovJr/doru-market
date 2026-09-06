import { describe, expect, it, vi } from 'vitest'
import type { RefundOnReturnResolvedUseCase } from './refund-on-return-resolved.use-case.js'
import { RefundOnReturnResolvedSubscriber } from './refund-on-return-resolved.subscriber.js'

describe('RefundOnReturnResolvedSubscriber (DTJ-274)', () => {
  it('ReturnConfirmedEvent — делегирует RefundOnReturnResolvedUseCase.execute с маппингом полей события в команду', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const refundOnReturnResolved = { execute } as unknown as RefundOnReturnResolvedUseCase
    const subscriber = new RefundOnReturnResolvedSubscriber(refundOnReturnResolved)

    await subscriber.handle({
      tenantId: 'tenant-1',
      eventId: 'evt-1',
      event: { type: 'ReturnConfirmedEvent', returnId: 'return-1', orderId: 'order-1', reason: 'defect', disposition: 'restock' },
    })

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1',
      returnId: 'return-1',
      orderId: 'order-1',
      reason: 'defect',
      disposition: 'restock',
      eventId: 'evt-1',
    })
  })

  it('ReturnRejectedEvent — НЕ вызывает RefundOnReturnResolvedUseCase.execute (отклонённый возврат не триггерит рефанд)', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const refundOnReturnResolved = { execute } as unknown as RefundOnReturnResolvedUseCase
    const subscriber = new RefundOnReturnResolvedSubscriber(refundOnReturnResolved)

    await subscriber.handle({
      tenantId: 'tenant-1',
      eventId: 'evt-2',
      event: { type: 'ReturnRejectedEvent', returnId: 'return-1', orderId: 'order-1', rejectionReason: 'packaging tampered' },
    })

    expect(execute).not.toHaveBeenCalled()
  })
})
