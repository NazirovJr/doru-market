import type { Queue } from 'bullmq'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { OutboxClaim, OutboxEventRecord, OutboxReaderPort } from './outbox-reader.port.js'
import { OutboxRelayProcessor } from './outbox-relay.processor.js'

function createEvent(id: string): OutboxEventRecord {
  return {
    id,
    eventType: 'OrderCreatedEvent',
    aggregateType: 'order',
    aggregateId: id,
    tenantId: 'tenant-1',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    payload: { orderId: id },
  }
}

function createClaim(events: readonly OutboxEventRecord[]): OutboxClaim & {
  markPublishedMock: Mock<OutboxClaim['markPublished']>
  recordFailureMock: Mock<OutboxClaim['recordFailure']>
  commitMock: Mock<OutboxClaim['commit']>
} {
  const markPublishedMock: Mock<OutboxClaim['markPublished']> = vi.fn().mockResolvedValue(undefined)
  const recordFailureMock: Mock<OutboxClaim['recordFailure']> = vi.fn().mockResolvedValue(undefined)
  const commitMock: Mock<OutboxClaim['commit']> = vi.fn().mockResolvedValue(undefined)
  return { events, markPublished: markPublishedMock, recordFailure: recordFailureMock, commit: commitMock, markPublishedMock, recordFailureMock, commitMock }
}

describe('OutboxRelayProcessor', () => {
  let claimPendingMock: Mock<OutboxReaderPort['claimPending']>
  let addMock: Mock<Queue['add']>
  let processor: OutboxRelayProcessor

  beforeEach(() => {
    claimPendingMock = vi.fn()
    addMock = vi.fn().mockResolvedValue(undefined)

    const outboxReader: OutboxReaderPort = { claimPending: claimPendingMock }
    const domainEventsQueue = { add: addMock } as unknown as Queue
    processor = new OutboxRelayProcessor(outboxReader, domainEventsQueue)
  })

  it('пустой батч — ни одной публикации, но claim.commit() всё равно вызван', async () => {
    const claim = createClaim([])
    claimPendingMock.mockResolvedValue(claim)

    const processed = await processor.relayOnce()

    expect(processed).toBe(0)
    expect(addMock).not.toHaveBeenCalled()
    expect(claim.commitMock).toHaveBeenCalledTimes(1)
  })

  it('публикует каждую строку в domain-events конвертом DomainEventEnvelope и вызывает markPublished для каждой', async () => {
    const events = [createEvent('evt-1'), createEvent('evt-2'), createEvent('evt-3')]
    const claim = createClaim(events)
    claimPendingMock.mockResolvedValue(claim)

    const processed = await processor.relayOnce()

    expect(processed).toBe(3)
    expect(claim.markPublishedMock).toHaveBeenCalledTimes(3)
    expect(claim.recordFailureMock).not.toHaveBeenCalled()
    expect(claim.commitMock).toHaveBeenCalledTimes(1)
    for (const event of events) {
      expect(addMock).toHaveBeenCalledWith(event.eventType, {
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        tenantId: event.tenantId,
        occurredAt: event.occurredAt.toISOString(),
        payload: event.payload,
      }, { jobId: event.id })
      expect(claim.markPublishedMock).toHaveBeenCalledWith(event.id)
    }
  })

  it('падение публикации ОДНОЙ строки (queue.add) не роняет тик — остальные published, упавшая recordFailure', async () => {
    const events = [createEvent('evt-1'), createEvent('evt-2'), createEvent('evt-3')]
    const claim = createClaim(events)
    claimPendingMock.mockResolvedValue(claim)
    addMock.mockImplementation(((_name: string, _data: unknown, opts?: { jobId?: string }) =>
      opts?.jobId === 'evt-2' ? Promise.reject(new Error('redis unavailable')) : Promise.resolve(undefined)) as unknown as Queue['add'])

    const processed = await processor.relayOnce()

    expect(processed).toBe(3)
    expect(claim.markPublishedMock).toHaveBeenCalledWith('evt-1')
    expect(claim.markPublishedMock).toHaveBeenCalledWith('evt-3')
    expect(claim.markPublishedMock).not.toHaveBeenCalledWith('evt-2')
    expect(claim.recordFailureMock).toHaveBeenCalledExactlyOnceWith('evt-2')
    expect(claim.commitMock).toHaveBeenCalledTimes(1)
  })
})
