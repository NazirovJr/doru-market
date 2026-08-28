import type { Queue } from 'bullmq'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { OutboxEventRecord, OutboxReaderPort } from './outbox-reader.port.js'
import { OutboxRelayProcessor } from './outbox-relay.processor.js'

function createEvent(id: string): OutboxEventRecord {
  return { id, eventType: 'OrderCreatedEvent', payload: { orderId: id } }
}

describe('OutboxRelayProcessor', () => {
  // Отдельные переменные для моков (не `outboxReader.readPending` напрямую) — иначе
  // @typescript-eslint/unbound-method ругается на ссылку на метод интерфейса без вызова.
  let readPendingMock: Mock<OutboxReaderPort['readPending']>
  let markPublishedMock: Mock<OutboxReaderPort['markPublished']>
  let addMock: Mock<Queue['add']>
  let processor: OutboxRelayProcessor

  beforeEach(() => {
    readPendingMock = vi.fn()
    markPublishedMock = vi.fn().mockResolvedValue(undefined)
    addMock = vi.fn().mockResolvedValue(undefined)

    const outboxReader: OutboxReaderPort = { readPending: readPendingMock, markPublished: markPublishedMock }
    const domainEventsQueue = { add: addMock } as unknown as Queue
    processor = new OutboxRelayProcessor(outboxReader, domainEventsQueue)
  })

  it('ни разу не вызывает markPublished, когда readPending возвращает пустой массив', async () => {
    readPendingMock.mockResolvedValue([])

    const processed = await processor.relayOnce()

    expect(processed).toBe(0)
    expect(addMock).not.toHaveBeenCalled()
    expect(markPublishedMock).not.toHaveBeenCalled()
  })

  it('публикует каждую строку в domain-events и вызывает markPublished для каждой', async () => {
    const events = [createEvent('evt-1'), createEvent('evt-2'), createEvent('evt-3')]
    readPendingMock.mockResolvedValue(events)

    const processed = await processor.relayOnce()

    expect(processed).toBe(3)
    expect(markPublishedMock).toHaveBeenCalledTimes(3)
    for (const event of events) {
      expect(addMock).toHaveBeenCalledWith(event.eventType, event.payload, { jobId: event.id })
      expect(markPublishedMock).toHaveBeenCalledWith(event.id)
    }
  })
})
