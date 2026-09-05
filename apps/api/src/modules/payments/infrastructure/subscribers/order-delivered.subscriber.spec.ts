import { describe, expect, it, vi } from 'vitest'
import type { CaptureEscrowUseCase } from '@/modules/payments/application/use-cases/capture-escrow.use-case.js'
import { OrderDeliveredSubscriber } from './order-delivered.subscriber.js'

describe('OrderDeliveredSubscriber (DTJ-244)', () => {
  it('handle() делегирует CaptureEscrowUseCase.execute с маппингом полей события в команду', async () => {
    const execute = vi.fn().mockResolvedValue(undefined)
    const captureEscrow = { execute } as unknown as CaptureEscrowUseCase
    const subscriber = new OrderDeliveredSubscriber(captureEscrow)

    await subscriber.handle({ tenantId: 'tenant-1', orderId: 'order-1', deliveredAt: new Date('2026-09-04T10:00:00Z'), eventId: 'evt-1' })

    expect(execute).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', orderId: 'order-1', eventId: 'evt-1' })
  })
})
