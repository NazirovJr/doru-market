import { Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from './domain-event-handler.js'
import { DomainEventsRouter } from './domain-events.router.js'

const fakeWorkerClose = vi.fn().mockResolvedValue(undefined)
const fakeWorkerOn = vi.fn()

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function fakeWorker(this: { close: Mock; on: Mock }) {
    this.close = fakeWorkerClose
    this.on = fakeWorkerOn
  }),
}))

function fakeHandler(consumerName: string, eventTypes: readonly string[], handle: Mock): DomainEventHandler {
  return { consumerName, eventTypes, handle }
}

function envelope(eventType: string): DomainEventEnvelope {
  return { eventId: 'evt-1', eventType, aggregateType: 'order', aggregateId: 'agg-1', tenantId: 't-1', occurredAt: '2026-01-01T00:00:00.000Z', payload: {} }
}

describe('DomainEventsRouter', () => {
  let connection: Redis
  let quitMock: Mock
  let registry: DomainEventHandlerRegistry
  let router: DomainEventsRouter

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    quitMock = vi.fn().mockResolvedValue(undefined)
    connection = { quit: quitMock } as unknown as Redis
    registry = new DomainEventHandlerRegistry()
    router = new DomainEventsRouter(connection, registry)
  })

  function tickFn(): (job: { data: DomainEventEnvelope }) => Promise<void> {
    router.onModuleInit()
    const [, fn] = (Worker as unknown as Mock).mock.calls[0] as [string, (job: { data: DomainEventEnvelope }) => Promise<void>]
    return fn
  }

  it('АС1: два обработчика подписаны на один eventType — оба вызваны ровно один раз', async () => {
    const handleA = vi.fn().mockResolvedValue(undefined)
    const handleB = vi.fn().mockResolvedValue(undefined)
    registry.register(fakeHandler('a', ['ReturnConfirmedEvent'], handleA))
    registry.register(fakeHandler('b', ['ReturnConfirmedEvent'], handleB))

    await tickFn()({ data: envelope('ReturnConfirmedEvent') })

    expect(handleA).toHaveBeenCalledTimes(1)
    expect(handleB).toHaveBeenCalledTimes(1)
  })

  it('АС3: событие без обработчиков — job завершается без ошибки', async () => {
    await expect(tickFn()({ data: envelope('unknown.event') })).resolves.toBeUndefined()
  })

  it('падение одного обработчика роняет job (BullMQ ретраит всю job\'у)', async () => {
    const handleA = vi.fn().mockResolvedValue(undefined)
    const handleB = vi.fn().mockRejectedValue(new Error('boom'))
    registry.register(fakeHandler('a', ['X'], handleA))
    registry.register(fakeHandler('b', ['X'], handleB))

    await expect(tickFn()({ data: envelope('X') })).rejects.toThrow('boom')
  })

  it('onModuleDestroy закрывает Worker и Redis-соединение', async () => {
    router.onModuleInit()

    await router.onModuleDestroy()

    expect(fakeWorkerClose).toHaveBeenCalledTimes(1)
    expect(quitMock).toHaveBeenCalledTimes(1)
  })
})
