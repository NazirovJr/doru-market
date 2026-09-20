import { describe, expect, it, vi } from 'vitest'
import type Redis from 'ioredis'
import { SlaWatchdogProcessor, SLA_WATCHDOG_JOB_HARD, SLA_WATCHDOG_JOB_SOFT } from './sla-watchdog.processor.js'

interface FakeQueue {
  add: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeProcessor(): { processor: SlaWatchdogProcessor; addMock: ReturnType<typeof vi.fn>; closeMock: ReturnType<typeof vi.fn> } {
  const addMock = vi.fn().mockResolvedValue(undefined)
  const closeMock = vi.fn().mockResolvedValue(undefined)
  const processor = new SlaWatchdogProcessor({} as unknown as Redis)
  ;(processor as unknown as { queue: FakeQueue }).queue = { add: addMock, close: closeMock }
  return { processor, addMock, closeMock }
}

describe('SlaWatchdogProcessor.schedule (DTJ-307)', () => {
  it('schedule({ orderId: "order-1", tenantId: "tenant-1", softDelayMinutes: 7, hardDelayMinutes: 12 }) → add вызван дважды', async () => {
    const { processor, addMock } = makeProcessor()

    await processor.schedule({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      softDelayMinutes: 7,
      hardDelayMinutes: 12,
    })

    expect(addMock).toHaveBeenCalledTimes(2)

    // Первый вызов: мягкий джоб
    expect(addMock).toHaveBeenNthCalledWith(1, SLA_WATCHDOG_JOB_SOFT, { orderId: 'order-1', tenantId: 'tenant-1' }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800 },
      jobId: 'sla-soft-order-1',
      delay: 420_000, // 7 минут в миллисекундах
    })

    // Второй вызов: жёсткий джоб
    expect(addMock).toHaveBeenNthCalledWith(2, SLA_WATCHDOG_JOB_HARD, { orderId: 'order-1', tenantId: 'tenant-1' }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: { age: 604_800 },
      jobId: 'sla-hard-order-1',
      delay: 720_000, // 12 минут в миллисекундах
    })
  })

  it('оба jobId не содержат ":" (ограничение BullMQ)', async () => {
    const { processor, addMock } = makeProcessor()

    await processor.schedule({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      softDelayMinutes: 7,
      hardDelayMinutes: 12,
    })

    // Проверяем, что jobId не содержат ':'
    const calls = addMock.mock.calls
    expect((calls[0] as unknown[])[2] as { jobId: string }).toHaveProperty('jobId')
    expect((calls[1] as unknown[])[2] as { jobId: string }).toHaveProperty('jobId')
    
    // Проверяем, что jobId не содержат ':'
    const job1JobId = (calls[0] as unknown[])[2] as { jobId: string }
    const job2JobId = (calls[1] as unknown[])[2] as { jobId: string }
    expect(job1JobId.jobId).not.toContain(':')
    expect(job2JobId.jobId).not.toContain(':')
  })

  it('повторный schedule для того же заказа даёт те же два jobId (дедупликация — BullMQ по jobId)', async () => {
    const { processor, addMock } = makeProcessor()

    await processor.schedule({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      softDelayMinutes: 7,
      hardDelayMinutes: 12,
    })

    // Повторный вызов
    await processor.schedule({
      orderId: 'order-1',
      tenantId: 'tenant-1',
      softDelayMinutes: 7,
      hardDelayMinutes: 12,
    })

    // Проверяем, что add был вызван 4 раза (два вызова для первого и два для второго schedule)
    expect(addMock).toHaveBeenCalledTimes(4)
    
    // Проверяем, что jobId остались теми же
    const calls = addMock.mock.calls
    expect((calls[0] as unknown[])[2] as { jobId: string }).toHaveProperty('jobId', 'sla-soft-order-1')
    expect((calls[1] as unknown[])[2] as { jobId: string }).toHaveProperty('jobId', 'sla-hard-order-1')
    expect((calls[2] as unknown[])[2] as { jobId: string }).toHaveProperty('jobId', 'sla-soft-order-1')  // Повтор
    expect((calls[3] as unknown[])[2] as { jobId: string }).toHaveProperty('jobId', 'sla-hard-order-1')  // Повтор
  })

  it('onModuleDestroy вызывает queue.close() один раз', async () => {
    const { processor, closeMock } = makeProcessor()

    await processor.onModuleDestroy()

    expect(closeMock).toHaveBeenCalledTimes(1)
  })
})