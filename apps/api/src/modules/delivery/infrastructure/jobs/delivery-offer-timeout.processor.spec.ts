import { describe, expect, it, vi } from 'vitest'
import type Redis from 'ioredis'
import { DeliveryOfferTimeoutProcessor, DELIVERY_OFFER_TIMEOUT_QUEUE_NAME } from './delivery-offer-timeout.processor.js'

interface FakeQueue {
  add: ReturnType<typeof vi.fn>
  getJob: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeProcessor(): { processor: DeliveryOfferTimeoutProcessor; queue: FakeQueue } {
  const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined), getJob: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }
  const processor = new DeliveryOfferTimeoutProcessor({} as unknown as Redis)
  ;(processor as unknown as { queue: FakeQueue }).queue = queue
  return { processor, queue }
}

describe('DeliveryOfferTimeoutProcessor', () => {
  it('schedule: queue.add с jobId=offerId, delay=delaySeconds×1000мс', async () => {
    const { processor, queue } = makeProcessor()

    await processor.schedule({ offerId: 'offer-1', delaySeconds: 45 })

    const [queueName, payload, options] = queue.add.mock.calls[0] as [string, unknown, { jobId: string; delay: number }]
    expect(queueName).toBe(DELIVERY_OFFER_TIMEOUT_QUEUE_NAME)
    expect(payload).toEqual({ offerId: 'offer-1' })
    expect(options.jobId).toBe('offer-1')
    expect(options.delay).toBe(45_000)
  })

  it('cancel: находит job по offerId и вызывает job.remove()', async () => {
    const { processor, queue } = makeProcessor()
    const removeMock = vi.fn().mockResolvedValue(undefined)
    queue.getJob.mockResolvedValue({ remove: removeMock })

    await processor.cancel('offer-1')

    expect(queue.getJob).toHaveBeenCalledWith('offer-1')
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('cancel: job уже не существует (принят до срабатывания и удалён ранее) -> no-op, не бросает', async () => {
    const { processor, queue } = makeProcessor()
    queue.getJob.mockResolvedValue(undefined)

    await expect(processor.cancel('offer-1')).resolves.toBeUndefined()
  })

  it('onModuleDestroy вызывает queue.close()', async () => {
    const { processor, queue } = makeProcessor()
    await processor.onModuleDestroy()
    expect(queue.close).toHaveBeenCalledTimes(1)
  })
})
