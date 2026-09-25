import { describe, expect, it, vi } from 'vitest'
import type { ProductEventsRepositoryPort } from '../ports/product-events-repository.port.js'
import { RealizedSavingsCalculator, type RealizedSavingsCalculateInput } from './realized-savings-calculator.js'

function buildHarness() {
  const findMatchingSavingsEventsMock = vi.fn<ProductEventsRepositoryPort['findMatchingSavingsEvents']>()
  const repository: ProductEventsRepositoryPort = {
    insert: vi.fn(),
    insertBatch: vi.fn(),
    findMatchingSavingsEvents: findMatchingSavingsEventsMock,
    // DTJ-381 — воронка не используется этим сервисом, стаб для соответствия расширенному порту.
    countByEventType: vi.fn<ProductEventsRepositoryPort['countByEventType']>().mockResolvedValue({}),
    sumSavingsByEventType: vi.fn<ProductEventsRepositoryPort['sumSavingsByEventType']>().mockResolvedValue(0n),
    getWeeklyRealizedSavingsTrend: vi.fn<ProductEventsRepositoryPort['getWeeklyRealizedSavingsTrend']>().mockResolvedValue([]),
  }
  const calculator = new RealizedSavingsCalculator(repository)
  return { calculator, findMatchingSavingsEventsMock }
}

function input(overrides: Partial<RealizedSavingsCalculateInput> = {}): RealizedSavingsCalculateInput {
  return { orderId: 'order-1', orderItems: [{ medicineId: 'medicine-1' }], tenantId: 'tenant-1', sessionId: 'session-1', ...overrides }
}

describe('RealizedSavingsCalculator', () => {
  it('AC1 — совпадение analog_shown по (sessionId, medicineId) → сумма savingsDiram позиции', async () => {
    const { calculator, findMatchingSavingsEventsMock } = buildHarness()
    findMatchingSavingsEventsMock.mockResolvedValue(new Map([['medicine-1', 5_000n]]))

    const result = await calculator.calculate(input())

    expect(result).toBe(5_000n)
    expect(findMatchingSavingsEventsMock).toHaveBeenCalledWith('tenant-1', 'session-1', ['medicine-1'])
  })

  it('несколько позиций, у каждой своё совпадение → сумма по всем позициям', async () => {
    const { calculator, findMatchingSavingsEventsMock } = buildHarness()
    findMatchingSavingsEventsMock.mockResolvedValue(
      new Map([
        ['medicine-1', 5_000n],
        ['medicine-2', 1_500n],
      ]),
    )

    const result = await calculator.calculate(
      input({ orderItems: [{ medicineId: 'medicine-1' }, { medicineId: 'medicine-2' }] }),
    )

    expect(result).toBe(6_500n)
  })

  it('AC2 — нет предшествующего analog_shown/added_to_cart для позиции → 0, не ошибка', async () => {
    const { calculator, findMatchingSavingsEventsMock } = buildHarness()
    findMatchingSavingsEventsMock.mockResolvedValue(new Map())

    const result = await calculator.calculate(input())

    expect(result).toBe(0n)
  })

  it('AC4 — заказ без позиций (пустой orderItems) → 0, репозиторий не вызывается вовсе', async () => {
    const { calculator, findMatchingSavingsEventsMock } = buildHarness()

    const result = await calculator.calculate(input({ orderItems: [] }))

    expect(result).toBe(0n)
    expect(findMatchingSavingsEventsMock).not.toHaveBeenCalled()
  })

  it('пустой sessionId → 0, репозиторий не вызывается (сравнение сессий пустой строкой было бы бессмысленным)', async () => {
    const { calculator, findMatchingSavingsEventsMock } = buildHarness()

    const result = await calculator.calculate(input({ sessionId: '' }))

    expect(result).toBe(0n)
    expect(findMatchingSavingsEventsMock).not.toHaveBeenCalled()
  })

  it('дубли medicineId в orderItems батчатся ОДНИМ запросом (без N+1), но сумма считается ПО КАЖДОЙ позиции', async () => {
    const { calculator, findMatchingSavingsEventsMock } = buildHarness()
    findMatchingSavingsEventsMock.mockResolvedValue(new Map([['medicine-1', 2_000n]]))

    const result = await calculator.calculate(
      input({ orderItems: [{ medicineId: 'medicine-1' }, { medicineId: 'medicine-1' }] }),
    )

    expect(findMatchingSavingsEventsMock).toHaveBeenCalledTimes(1)
    expect(result).toBe(4_000n)
  })
})
