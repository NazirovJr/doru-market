import { describe, expect, it, vi } from 'vitest'
import type { GetFunnelUseCase, GetFunnelResult } from '../application/use-cases/get-funnel.use-case.js'
import type { GetPlatformMetricsUseCase, GetPlatformMetricsResult } from '../application/use-cases/get-platform-metrics.use-case.js'
import { AnalyticsDashboardController } from './analytics-dashboard.controller.js'

function baseResult(overrides: Partial<GetFunnelResult> = {}): GetFunnelResult {
  return {
    searchPerformed: 500,
    analogShown: 100,
    analogClicked: 20,
    addedToCart: 15,
    orderPlaced: 10,
    conversionRates: { shownToClicked: 0.2, clickedToCart: 0.75, cartToOrder: 0.666_67, overallShownToOrder: 0.1 },
    totalSavingsShownDiram: 100_000n,
    totalSavingsRealizedDiram: 15_000n,
    weeklyTrend: [{ weekLabel: '2026-08-03', realizedSavingsDiram: 1_000n }],
    ...overrides,
  }
}

function basePlatformMetricsResult(overrides: Partial<GetPlatformMetricsResult> = {}): GetPlatformMetricsResult {
  return {
    gmvDiram: 500_000n,
    orderCount: 5,
    averageCheckDiram: 100_000n,
    pickupSlaComplianceRate: 0.8,
    deliverySlaComplianceRate: 0.7,
    cancellationRate: 0.1,
    activePharmaciesSendingDataRate: 0.375,
    ...overrides,
  }
}

function buildController(
  funnelExecute: GetFunnelUseCase['execute'] = vi.fn(),
  platformMetricsExecute: GetPlatformMetricsUseCase['execute'] = vi.fn(),
): AnalyticsDashboardController {
  return new AnalyticsDashboardController(
    { execute: funnelExecute } as unknown as GetFunnelUseCase,
    { execute: platformMetricsExecute } as unknown as GetPlatformMetricsUseCase,
  )
}

describe('AnalyticsDashboardController (DTJ-381)', () => {
  it('маппит query в GetFunnelUseCase.execute() и сериализует bigint-поля в number в ответе', async () => {
    const execute = vi.fn<GetFunnelUseCase['execute']>().mockResolvedValue(baseResult())
    const controller = buildController(execute)

    const response = await controller.funnel({ tenantId: 'tenant-1', period: '2026-08' })

    expect(execute).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', period: '2026-08' })
    expect(response.data.totalSavingsShownDiram).toBe(100_000)
    expect(response.data.totalSavingsRealizedDiram).toBe(15_000)
    expect(response.data.weeklyTrend).toEqual([{ weekLabel: '2026-08-03', realizedSavingsDiram: 1_000 }])
    expect(typeof response.data.totalSavingsShownDiram).toBe('number')
  })

  it('АС3 — ответ несёт И абсолютное значение реализованной экономии, И проценты конверсии одновременно', async () => {
    const execute = vi.fn<GetFunnelUseCase['execute']>().mockResolvedValue(baseResult())
    const controller = buildController(execute)

    const response = await controller.funnel({ tenantId: 'tenant-1', period: '2026-08' })

    expect(response.data.totalSavingsRealizedDiram).toBe(15_000)
    expect(response.data.totalSavingsShownDiram).toBe(100_000)
    expect(response.data.conversionRates.overallShownToOrder).toBe(0.1)
  })

  it('пустая воронка (все счётчики 0) — конверсии 0, не NaN, ответ собирается без исключения', async () => {
    const execute = vi.fn<GetFunnelUseCase['execute']>().mockResolvedValue(
      baseResult({
        searchPerformed: 0,
        analogShown: 0,
        analogClicked: 0,
        addedToCart: 0,
        orderPlaced: 0,
        conversionRates: { shownToClicked: 0, clickedToCart: 0, cartToOrder: 0, overallShownToOrder: 0 },
        totalSavingsShownDiram: 0n,
        totalSavingsRealizedDiram: 0n,
        weeklyTrend: [],
      }),
    )
    const controller = buildController(execute)

    const response = await controller.funnel({ tenantId: 'tenant-1', period: '2026-08' })

    expect(response.data.conversionRates).toEqual({ shownToClicked: 0, clickedToCart: 0, cartToOrder: 0, overallShownToOrder: 0 })
  })
})

describe('AnalyticsDashboardController.platformMetrics (DTJ-382)', () => {
  it('маппит query в GetPlatformMetricsUseCase.execute() и сериализует bigint-поля в number в ответе', async () => {
    const execute = vi.fn<GetPlatformMetricsUseCase['execute']>().mockResolvedValue(basePlatformMetricsResult())
    const controller = buildController(undefined, execute)

    const response = await controller.platformMetrics({ tenantId: 'tenant-1', period: '2026-08' })

    expect(execute).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', period: '2026-08' })
    expect(response.data).toEqual({
      gmvDiram: 500_000,
      orderCount: 5,
      averageCheckDiram: 100_000,
      pickupSlaComplianceRate: 0.8,
      deliverySlaComplianceRate: 0.7,
      cancellationRate: 0.1,
      activePharmaciesSendingDataRate: 0.375,
    })
    expect(typeof response.data.gmvDiram).toBe('number')
  })

  it('TC-ADM-030 — 3 из 8 активных аптек прислали данные → activePharmaciesSendingDataRate ≈ 0.375', async () => {
    const execute = vi
      .fn<GetPlatformMetricsUseCase['execute']>()
      .mockResolvedValue(basePlatformMetricsResult({ activePharmaciesSendingDataRate: 0.375 }))
    const controller = buildController(undefined, execute)

    const response = await controller.platformMetrics({ tenantId: 'tenant-1', period: '2026-08' })

    expect(response.data.activePharmaciesSendingDataRate).toBeCloseTo(0.375)
  })

  it('период без заказов, по которым измерим SLA → 0, не NaN/исключение (АС3 тикета)', async () => {
    const execute = vi
      .fn<GetPlatformMetricsUseCase['execute']>()
      .mockResolvedValue(basePlatformMetricsResult({ pickupSlaComplianceRate: 0, deliverySlaComplianceRate: 0 }))
    const controller = buildController(undefined, execute)

    const response = await controller.platformMetrics({ tenantId: 'tenant-1', period: '2020-01' })

    expect(response.data.pickupSlaComplianceRate).toBe(0)
    expect(Number.isNaN(response.data.pickupSlaComplianceRate)).toBe(false)
  })
})
