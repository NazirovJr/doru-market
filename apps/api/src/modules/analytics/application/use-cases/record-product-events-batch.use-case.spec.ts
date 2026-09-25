import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { ProductEventsRepositoryPort } from '../ports/product-events-repository.port.js'
import {
  RecordProductEventsBatchUseCase,
  type RecordProductEventsBatchCommand,
  type RecordProductEventsBatchItem,
} from './record-product-events-batch.use-case.js'

const NOW = new Date('2026-09-25T10:00:00.000Z')

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

function baseItem(overrides: Partial<RecordProductEventsBatchItem> = {}): RecordProductEventsBatchItem {
  return {
    eventType: 'search_performed',
    sessionId: 'session-1',
    ...overrides,
  }
}

function baseCommand(overrides: Partial<RecordProductEventsBatchCommand> = {}): RecordProductEventsBatchCommand {
  return {
    tenantId: 'tenant-1',
    userId: null,
    events: [baseItem()],
    ...overrides,
  }
}

function buildHarness() {
  const insertMock = vi.fn<ProductEventsRepositoryPort['insert']>().mockResolvedValue(undefined)
  const insertBatchMock = vi.fn<ProductEventsRepositoryPort['insertBatch']>().mockResolvedValue(undefined)
  const repository: ProductEventsRepositoryPort = {
    insert: insertMock,
    insertBatch: insertBatchMock,
    findMatchingSavingsEvents: vi.fn<ProductEventsRepositoryPort['findMatchingSavingsEvents']>().mockResolvedValue(new Map()),
  }
  const logger = { warn: vi.fn() } as unknown as Logger
  const useCase = new RecordProductEventsBatchUseCase(repository, new FixedClock(), logger)
  return { useCase, insertBatchMock, logger }
}

describe('RecordProductEventsBatchUseCase', () => {
  it('батч из валидных событий — insertBatch РОВНО ОДИН РАЗ со всеми событиями (АС1 DTJ-379)', async () => {
    const { useCase, insertBatchMock } = buildHarness()
    const events = [
      baseItem({ eventType: 'search_performed' }),
      baseItem({ eventType: 'analog_shown' }),
      baseItem({ eventType: 'analog_clicked' }),
    ]

    await useCase.execute(baseCommand({ events }))

    expect(insertBatchMock).toHaveBeenCalledTimes(1)
    expect(insertBatchMock.mock.calls[0]?.[0]).toHaveLength(3)
  })

  it('один элемент из 5 с неизвестным eventType — остальные 4 записаны, невалидный пропущен с warn (АС3 DTJ-379)', async () => {
    const { useCase, insertBatchMock, logger } = buildHarness()
    const events = [
      baseItem({ eventType: 'search_performed' }),
      baseItem({ eventType: 'analog_shown' }),
      baseItem({ eventType: 'unknown_future_event' }),
      baseItem({ eventType: 'analog_clicked' }),
      baseItem({ eventType: 'added_to_cart' }),
    ]

    await useCase.execute(baseCommand({ events }))

    const savedEvents = insertBatchMock.mock.calls[0]?.[0] ?? []
    expect(savedEvents).toHaveLength(4)
    expect(savedEvents.map((event) => event.eventType)).not.toContain('unknown_future_event')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'unknown_future_event' }),
      'analytics_events_batch_item_skipped',
    )
  })

  it('клиентский order_placed — пропущен с warn как неизвестный тип, остальные записаны (CTO-возврат: не накрутить savingsDiram)', async () => {
    const { useCase, insertBatchMock, logger } = buildHarness()
    const events = [
      baseItem({ eventType: 'order_placed', savingsDiram: 999_999n }),
      baseItem({ eventType: 'search_performed' }),
    ]

    await useCase.execute(baseCommand({ events }))

    const savedEvents = insertBatchMock.mock.calls[0]?.[0] ?? []
    expect(savedEvents).toHaveLength(1)
    expect(savedEvents.map((event) => event.eventType)).not.toContain('order_placed')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'order_placed' }),
      'analytics_events_batch_item_skipped',
    )
  })

  it('пустой sessionId у одного элемента — тот же частичный успех, что и неизвестный eventType', async () => {
    const { useCase, insertBatchMock, logger } = buildHarness()
    const events = [baseItem({ sessionId: '' }), baseItem({ eventType: 'analog_shown' })]

    await useCase.execute(baseCommand({ events }))

    expect(insertBatchMock.mock.calls[0]?.[0]).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('actor.userId не передан (userId=null) — событие сохраняется как гостевое (SRS-ADM-067)', async () => {
    const { useCase, insertBatchMock } = buildHarness()

    await useCase.execute(baseCommand({ userId: null }))

    expect(insertBatchMock.mock.calls[0]?.[0]?.[0]?.userId).toBeNull()
  })

  it('actor.userId передан — прокидывается в каждое событие батча', async () => {
    const { useCase, insertBatchMock } = buildHarness()
    const events = [baseItem({ eventType: 'search_performed' }), baseItem({ eventType: 'analog_shown' })]

    await useCase.execute(baseCommand({ userId: 'user-1', events }))

    const savedEvents = insertBatchMock.mock.calls[0]?.[0] ?? []
    expect(savedEvents.every((event) => event.userId === 'user-1')).toBe(true)
  })

  it('occurredAt всех событий батча — из ОДНОГО вызова Clock.now() (согласованный снэпшот времени)', async () => {
    const { useCase, insertBatchMock } = buildHarness()
    const events = [baseItem({ eventType: 'search_performed' }), baseItem({ eventType: 'analog_shown' })]

    await useCase.execute(baseCommand({ events }))

    const savedEvents = insertBatchMock.mock.calls[0]?.[0] ?? []
    expect(savedEvents.every((event) => event.occurredAt === NOW)).toBe(true)
  })

  it('пустой батч — insertBatch вызывается с пустым массивом, без ошибок', async () => {
    const { useCase, insertBatchMock } = buildHarness()

    await useCase.execute(baseCommand({ events: [] }))

    expect(insertBatchMock).toHaveBeenCalledWith([])
  })
})
