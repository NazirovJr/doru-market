import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@dorutj/contracts'
import type { ProductEventsRepositoryPort, WeeklyRealizedSavingsPoint } from '../ports/product-events-repository.port.js'
import { GetFunnelUseCase, parsePeriod } from './get-funnel.use-case.js'

const EMPTY_TREND: readonly WeeklyRealizedSavingsPoint[] = []

function buildHarness(counts: Readonly<Record<string, number>> = {}) {
  const countByEventTypeMock = vi.fn<ProductEventsRepositoryPort['countByEventType']>().mockResolvedValue(counts)
  const sumSavingsByEventTypeMock = vi.fn<ProductEventsRepositoryPort['sumSavingsByEventType']>().mockResolvedValue(0n)
  const getWeeklyRealizedSavingsTrendMock = vi
    .fn<ProductEventsRepositoryPort['getWeeklyRealizedSavingsTrend']>()
    .mockResolvedValue(EMPTY_TREND)
  const repository: ProductEventsRepositoryPort = {
    insert: vi.fn(),
    insertBatch: vi.fn(),
    findMatchingSavingsEvents: vi.fn(),
    countByEventType: countByEventTypeMock,
    sumSavingsByEventType: sumSavingsByEventTypeMock,
    getWeeklyRealizedSavingsTrend: getWeeklyRealizedSavingsTrendMock,
  }
  const useCase = new GetFunnelUseCase(repository)
  return { useCase, countByEventTypeMock, sumSavingsByEventTypeMock, getWeeklyRealizedSavingsTrendMock }
}

describe('GetFunnelUseCase', () => {
  it('TC-ADM-029 — analog_shown=100, analog_clicked=20, added_to_cart=15, order_placed=10 → overallShownToOrder=0.10', async () => {
    const { useCase } = buildHarness({
      search_performed: 500,
      analog_shown: 100,
      analog_clicked: 20,
      added_to_cart: 15,
      order_placed: 10,
    })

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result.conversionRates.overallShownToOrder).toBe(0.1)
    expect(result.conversionRates.shownToClicked).toBe(0.2)
    expect(result.conversionRates.clickedToCart).toBe(0.75)
    expect(result.conversionRates.cartToOrder).toBeCloseTo(0.666_67, 4)
    expect(result.searchPerformed).toBe(500)
    expect(result.analogShown).toBe(100)
    expect(result.orderPlaced).toBe(10)
  })

  it('АС2 — analog_shown=0 (нет данных за период) → shownToClicked=0, НЕ NaN/Infinity', async () => {
    const { useCase } = buildHarness({ analog_shown: 0, analog_clicked: 0 })

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result.conversionRates.shownToClicked).toBe(0)
    expect(Number.isNaN(result.conversionRates.shownToClicked)).toBe(false)
  })

  it.each([
    ['shownToClicked', { analog_clicked: 0 }],
    ['clickedToCart', { added_to_cart: 0 }],
    ['cartToOrder', { order_placed: 0 }],
    ['overallShownToOrder', { analog_shown: 0 }],
  ] as const)('деление на 0 на шаге %s изолированно даёт 0, не влияет на остальные ставки', async (_label, counts) => {
    const { useCase } = buildHarness(counts)

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    for (const rate of Object.values(result.conversionRates)) {
      expect(Number.isFinite(rate)).toBe(true)
    }
  })

  it('репозиторий не отдал ни одного eventType (пустой Record) — все счётчики 0, не undefined', async () => {
    const { useCase } = buildHarness({})

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result).toMatchObject({ searchPerformed: 0, analogShown: 0, analogClicked: 0, addedToCart: 0, orderPlaced: 0 })
  })

  it('totalSavingsShownDiram/totalSavingsRealizedDiram — из sumSavingsByEventType(analog_shown/order_placed) соответственно', async () => {
    const { useCase, sumSavingsByEventTypeMock } = buildHarness()
    sumSavingsByEventTypeMock.mockImplementation((_tenantId, _period, eventType) =>
      Promise.resolve(eventType === 'analog_shown' ? 100_000n : 15_000n),
    )

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result.totalSavingsShownDiram).toBe(100_000n)
    expect(result.totalSavingsRealizedDiram).toBe(15_000n)
  })

  it('weeklyTrend — прокинут из репозитория как есть, use case не пересчитывает суммы', async () => {
    const trend: readonly WeeklyRealizedSavingsPoint[] = [
      { weekLabel: '2026-08-03', realizedSavingsDiram: 1_000n },
      { weekLabel: '2026-08-10', realizedSavingsDiram: 2_000n },
    ]
    const { useCase, getWeeklyRealizedSavingsTrendMock } = buildHarness()
    getWeeklyRealizedSavingsTrendMock.mockResolvedValue(trend)

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result.weeklyTrend).toBe(trend)
  })

  it('запросы к репозиторию скопированы диапазоном месяца — [2026-08-01, 2026-09-01)', async () => {
    const { useCase, countByEventTypeMock } = buildHarness()

    await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    const [, period] = countByEventTypeMock.mock.calls[0] ?? []
    expect(period?.start.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(period?.end.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('невалидный формат period → ValidationError, репозиторий не вызывается', async () => {
    const { useCase, countByEventTypeMock } = buildHarness()

    await expect(useCase.execute({ tenantId: 'tenant-1', period: 'not-a-period' })).rejects.toThrow(ValidationError)
    expect(countByEventTypeMock).not.toHaveBeenCalled()
  })
})

describe('parsePeriod', () => {
  it('"YYYY-MM" → [первый день месяца, первый день следующего месяца)', () => {
    const range = parsePeriod('2026-02')

    expect(range.start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('"YYYY-MM" декабрь → следующий месяц переходит в следующий год', () => {
    const range = parsePeriod('2026-12')

    expect(range.end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('"YYYY-Www" (ISO-неделя, понедельник-старт) → 7-дневное окно', () => {
    // ISO-неделя 36 2026 — известное соответствие: 2026-01-01 приходится на четверг (неделя 1).
    const range = parsePeriod('2026-W01')

    expect(range.start.getUTCDay()).toBe(1) // Monday
    expect(range.end.getTime() - range.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('месяц вне 1..12 → ValidationError', () => {
    expect(() => parsePeriod('2026-13')).toThrow(ValidationError)
  })

  it('неделя вне 1..53 → ValidationError', () => {
    expect(() => parsePeriod('2026-W54')).toThrow(ValidationError)
  })

  it('произвольная строка → ValidationError', () => {
    expect(() => parsePeriod('август 2026')).toThrow(ValidationError)
  })
})
