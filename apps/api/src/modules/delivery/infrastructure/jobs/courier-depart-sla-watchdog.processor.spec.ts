import { describe, expect, it, vi } from 'vitest'
import type Redis from 'ioredis'
import { CourierDepartSlaWatchdogProcessor, COURIER_DEPART_SLA_WATCHDOG_QUEUE_NAME } from './courier-depart-sla-watchdog.processor.js'

interface FakeQueue {
  add: ReturnType<typeof vi.fn>
  getJob: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeProcessor(): { processor: CourierDepartSlaWatchdogProcessor; queue: FakeQueue } {
  const queue: FakeQueue = { add: vi.fn().mockResolvedValue(undefined), getJob: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }
  const processor = new CourierDepartSlaWatchdogProcessor({} as unknown as Redis)
  ;(processor as unknown as { queue: FakeQueue }).queue = queue
  return { processor, queue }
}

describe('CourierDepartSlaWatchdogProcessor', () => {
  it('schedule: queue.add с jobId=deliveryAssignmentId, delay=delayMinutes×60000мс', async () => {
    const { processor, queue } = makeProcessor()

    await processor.schedule({ deliveryAssignmentId: 'assignment-1', delayMinutes: 10 })

    const [queueName, payload, options] = queue.add.mock.calls[0] as [string, unknown, { jobId: string; delay: number }]
    expect(queueName).toBe(COURIER_DEPART_SLA_WATCHDOG_QUEUE_NAME)
    expect(payload).toEqual({ deliveryAssignmentId: 'assignment-1' })
    expect(options.jobId).toBe('assignment-1')
    expect(options.delay).toBe(600_000)
  })

  it('cancel: находит job по deliveryAssignmentId и вызывает job.remove()', async () => {
    const { processor, queue } = makeProcessor()
    const removeMock = vi.fn().mockResolvedValue(undefined)
    queue.getJob.mockResolvedValue({ remove: removeMock })

    await processor.cancel('assignment-1')

    expect(queue.getJob).toHaveBeenCalledWith('assignment-1')
    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('cancel: job уже не существует (переназначен ранее) -> no-op, не бросает', async () => {
    const { processor, queue } = makeProcessor()
    queue.getJob.mockResolvedValue(undefined)

    await expect(processor.cancel('assignment-1')).resolves.toBeUndefined()
  })

  it('onModuleDestroy вызывает queue.close()', async () => {
    const { processor, queue } = makeProcessor()
    await processor.onModuleDestroy()
    expect(queue.close).toHaveBeenCalledTimes(1)
  })
})
