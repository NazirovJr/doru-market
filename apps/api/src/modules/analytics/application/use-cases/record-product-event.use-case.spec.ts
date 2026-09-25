import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { ProductEventsRepositoryPort } from '../ports/product-events-repository.port.js'
import { RealizedSavingsCalculator } from '../services/realized-savings-calculator.js'
import { RecordProductEventUseCase, type RecordProductEventCommand } from './record-product-event.use-case.js'

const NOW = new Date('2026-09-24T10:00:00.000Z')

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

function baseCommand(overrides: Partial<RecordProductEventCommand> = {}): RecordProductEventCommand {
  return {
    tenantId: 'tenant-1',
    sessionId: 'session-1',
    eventType: 'search_performed',
    ...overrides,
  }
}

function buildHarness() {
  const insertMock = vi.fn<ProductEventsRepositoryPort['insert']>().mockResolvedValue(undefined)
  const insertBatchMock = vi.fn<ProductEventsRepositoryPort['insertBatch']>().mockResolvedValue(undefined)
  const findMatchingSavingsEventsMock = vi
    .fn<ProductEventsRepositoryPort['findMatchingSavingsEvents']>()
    .mockResolvedValue(new Map())
  const repository: ProductEventsRepositoryPort = {
    insert: insertMock,
    insertBatch: insertBatchMock,
    findMatchingSavingsEvents: findMatchingSavingsEventsMock,
  }
  const calculator = new RealizedSavingsCalculator(repository)
  const useCase = new RecordProductEventUseCase(repository, new FixedClock(), calculator)
  return { useCase, insertMock, findMatchingSavingsEventsMock }
}

describe('RecordProductEventUseCase', () => {
  it('команда с известным eventType — вызывает repository.insert() РОВНО ОДИН РАЗ с occurredAt из Clock (АС1 DTJ-378)', async () => {
    const { useCase, insertMock } = buildHarness()

    await useCase.execute(baseCommand({ eventType: 'order_placed', orderId: 'order-1' }))

    expect(insertMock).toHaveBeenCalledTimes(1)
    const savedEvent = insertMock.mock.calls[0]?.[0]
    expect(savedEvent?.eventType).toBe('order_placed')
    expect(savedEvent?.occurredAt).toBe(NOW)
  })

  it('eventType вне известного списка — ValidationError из домена ДО repository.insert() (АС2 DTJ-378)', async () => {
    const { useCase, insertMock } = buildHarness()

    await expect(useCase.execute(baseCommand({ eventType: 'typo_event' }))).rejects.toThrow(ValidationError)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('sessionId пустой — ValidationError ДО repository.insert()', async () => {
    const { useCase, insertMock } = buildHarness()

    await expect(useCase.execute(baseCommand({ sessionId: '' }))).rejects.toThrow(ValidationError)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('userId не передан — гостевое событие, use case не подставляет ничего вместо null', async () => {
    const { useCase, insertMock } = buildHarness()

    await useCase.execute(baseCommand())

    expect(insertMock.mock.calls[0]?.[0]?.userId).toBeNull()
  })

  it('DTJ-380 — eventType="order_placed" делегирует savingsDiram RealizedSavingsCalculator (не command.savingsDiram буквально)', async () => {
    const { useCase, insertMock, findMatchingSavingsEventsMock } = buildHarness()
    findMatchingSavingsEventsMock.mockResolvedValue(new Map([['medicine-1', 5_000n]]))

    await useCase.execute(
      baseCommand({
        eventType: 'order_placed',
        orderId: 'order-1',
        orderItems: [{ medicineId: 'medicine-1' }],
        savingsDiram: 999n, // не должно попасть в запись напрямую — калькулятор пересчитывает.
      }),
    )

    expect(findMatchingSavingsEventsMock).toHaveBeenCalledWith('tenant-1', 'session-1', ['medicine-1'])
    expect(insertMock.mock.calls[0]?.[0]?.toSnapshot().savingsDiram).toBe(5_000n)
  })

  it('DTJ-380 — eventType≠"order_placed" НЕ вызывает RealizedSavingsCalculator, savingsDiram передан буквально', async () => {
    const { useCase, insertMock, findMatchingSavingsEventsMock } = buildHarness()

    await useCase.execute(baseCommand({ eventType: 'analog_shown', savingsDiram: 4_200n }))

    expect(findMatchingSavingsEventsMock).not.toHaveBeenCalled()
    expect(insertMock.mock.calls[0]?.[0]?.toSnapshot().savingsDiram).toBe(4_200n)
  })
})
