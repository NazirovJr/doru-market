/**
 * `PartialFulfillmentTimeoutProcessor` (EP-12, DTJ-304) — unit-тест на мок `Queue` (тот же
 * приём, что `bullmq-inventory-sync-queue.adapter.spec.ts`, DTJ-153: подмена внутреннего
 * `queue` на фейк-объект ради проверки КОНТРАКТА адаптера — `jobId`/`delay`/payload) — не
 * требует реального Redis, ВСЕГДА выполняется в CI. Реальный BullMQ/Redis-прогон (полное
 * доказательство дедупликации силами самого BullMQ) —
 * `test/integration/orders/partial-fulfillment-timeout.processor.integration.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import type Redis from 'ioredis'
import { PartialFulfillmentTimeoutProcessor, PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME } from './partial-fulfillment-timeout.processor.js'

interface FakeQueue {
  add: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeProcessor(): { processor: PartialFulfillmentTimeoutProcessor; addMock: ReturnType<typeof vi.fn>; closeMock: ReturnType<typeof vi.fn> } {
  const addMock = vi.fn().mockResolvedValue(undefined)
  const closeMock = vi.fn().mockResolvedValue(undefined)
  const processor = new PartialFulfillmentTimeoutProcessor({} as unknown as Redis)
  ;(processor as unknown as { queue: FakeQueue }).queue = { add: addMock, close: closeMock }
  return { processor, addMock, closeMock }
}

describe('PartialFulfillmentTimeoutProcessor.schedule (DTJ-304, DoD: jobId = requestId)', () => {
  it('вызывает queue.add с jobId=requestId, delay=timeoutMinutes×60000мс, payload={requestId,tenantId}', async () => {
    const { processor, addMock } = makeProcessor()

    await processor.schedule({ requestId: 'req-1', tenantId: 'tenant-1', timeoutMinutes: 10 })

    expect(addMock).toHaveBeenCalledTimes(1)
    const [queueName, payload, options] = addMock.mock.calls[0] as [string, unknown, { jobId: string; delay: number }]
    expect(queueName).toBe(PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME)
    expect(payload).toEqual({ requestId: 'req-1', tenantId: 'tenant-1' })
    expect(options.jobId).toBe('req-1')
    expect(options.delay).toBe(600_000)
  })

  it('повторный schedule() с ТЕМ ЖЕ requestId всегда передаёт ТОТ ЖЕ jobId (дедупликация — забота самого BullMQ, адаптер гарантирует только инвариант jobId===requestId)', async () => {
    const { processor, addMock } = makeProcessor()

    await processor.schedule({ requestId: 'req-dup', tenantId: 'tenant-1', timeoutMinutes: 10 })
    await processor.schedule({ requestId: 'req-dup', tenantId: 'tenant-1', timeoutMinutes: 10 })

    const opts1 = (addMock.mock.calls[0] as unknown[])[2] as { jobId: string }
    const opts2 = (addMock.mock.calls[1] as unknown[])[2] as { jobId: string }
    expect(opts1.jobId).toBe('req-dup')
    expect(opts2.jobId).toBe('req-dup')
  })

  it('timeoutMinutes=7 → delay=420000мс (минуты→мс, не наоборот)', async () => {
    const { processor, addMock } = makeProcessor()

    await processor.schedule({ requestId: 'req-2', tenantId: 'tenant-1', timeoutMinutes: 7 })

    const options = (addMock.mock.calls[0] as unknown[])[2] as { delay: number }
    expect(options.delay).toBe(420_000)
  })

  it('onModuleDestroy вызывает queue.close()', async () => {
    const { processor, closeMock } = makeProcessor()
    await processor.onModuleDestroy()
    expect(closeMock).toHaveBeenCalledTimes(1)
  })
})
