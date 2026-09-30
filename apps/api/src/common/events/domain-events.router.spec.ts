import { Logger } from '@nestjs/common'
import { Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { DomainEventEnvelope } from '@dorutj/contracts'
import { DomainEventHandlerRegistry, type DomainEventHandler } from './domain-event-handler.js'
import { DomainEventsRouter } from './domain-events.router.js'
import type { ProcessedEventsPort } from './processed-events.port.js'

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
  let processed: Set<string>

  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkerClose.mockClear()
    quitMock = vi.fn().mockResolvedValue(undefined)
    connection = { quit: quitMock } as unknown as Redis
    registry = new DomainEventHandlerRegistry()
    processed = new Set()
    const processedEvents: ProcessedEventsPort = {
      isProcessed: (consumer, eventId) => Promise.resolve(processed.has(`${consumer}:${eventId}`)),
      markProcessed: (consumer, eventId) => Promise.resolve(processed.add(`${consumer}:${eventId}`).size > 0),
    }
    router = new DomainEventsRouter(connection, registry, processedEvents)
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

  it('ретрай: второй обработчик упал в первый раз — при повторе первый НЕ вызывается снова, второй выполняется; каждый отработал по разу', async () => {
    const handleA = vi.fn().mockResolvedValue(undefined)
    const handleB = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    registry.register(fakeHandler('a', ['X'], handleA))
    registry.register(fakeHandler('b', ['X'], handleB))
    const tick = tickFn()

    await expect(tick({ data: envelope('X') })).rejects.toThrow('consumers [b] failed: boom')
    await tick({ data: envelope('X') })

    expect(handleA).toHaveBeenCalledTimes(1)
    expect(handleB).toHaveBeenCalledTimes(2)
    expect([...processed].sort()).toEqual(['a:evt-1', 'b:evt-1'])
  })

  it('упавший обработчик не помечается обработанным', async () => {
    registry.register(fakeHandler('a', ['X'], vi.fn().mockRejectedValue(new Error('boom'))))

    await expect(tickFn()({ data: envelope('X') })).rejects.toThrow()

    expect(processed.size).toBe(0)
  })

  it('обработчик, уже отработавший событие (в т.ч. в собственной транзакции), пропускается', async () => {
    const handleA = vi.fn().mockResolvedValue(undefined)
    registry.register(fakeHandler('a', ['X'], handleA))
    processed.add('a:evt-1')

    await tickFn()({ data: envelope('X') })

    expect(handleA).not.toHaveBeenCalled()
  })

  it('исчерпание попыток логируется error с eventId, промежуточный сбой — warn', () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    router.onModuleInit()
    const onFailed = fakeWorkerOn.mock.calls.find(([event]) => event === 'failed')?.[1] as (job: unknown, error: Error) => void
    const job = (attemptsMade: number): unknown => ({ name: 'X', attemptsMade, opts: { attempts: 10 }, data: envelope('X') })

    onFailed(job(3), new Error('boom'))
    onFailed(job(10), new Error('boom'))

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('eventId=evt-1'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ИСЧЕРПАНЫ'))
  })

  it('onModuleDestroy закрывает Worker и Redis-соединение', async () => {
    router.onModuleInit()

    await router.onModuleDestroy()

    expect(fakeWorkerClose).toHaveBeenCalledTimes(1)
    expect(quitMock).toHaveBeenCalledTimes(1)
  })
})
