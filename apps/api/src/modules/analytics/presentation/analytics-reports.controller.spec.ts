import { describe, expect, it, vi } from 'vitest'
import type { GetTopAnalogsReportUseCase, GetTopAnalogsReportResult } from '../application/use-cases/get-top-analogs-report.use-case.js'
import type { GetOnboardingFunnelUseCase, GetOnboardingFunnelResult } from '../application/use-cases/get-onboarding-funnel.use-case.js'
import { AnalyticsReportsController } from './analytics-reports.controller.js'

function baseTopAnalogsResult(): GetTopAnalogsReportResult {
  return [{ medicineId: 'med-1', medicineName: 'Панадол', avgSavingsDiram: 2_000n, timesShown: 50, conversionToOrder: 0.1 }]
}

function buildController(
  topAnalogsExecute: GetTopAnalogsReportUseCase['execute'] = vi.fn(),
  onboardingFunnelExecute: GetOnboardingFunnelUseCase['execute'] = vi.fn(),
): AnalyticsReportsController {
  return new AnalyticsReportsController(
    { execute: topAnalogsExecute } as unknown as GetTopAnalogsReportUseCase,
    { execute: onboardingFunnelExecute } as unknown as GetOnboardingFunnelUseCase,
  )
}

describe('AnalyticsReportsController.topAnalogs (DTJ-383)', () => {
  it('маппит query в GetTopAnalogsReportUseCase.execute() и сериализует bigint-поле в number', async () => {
    const execute = vi.fn<GetTopAnalogsReportUseCase['execute']>().mockResolvedValue(baseTopAnalogsResult())
    const controller = buildController(execute)

    const response = await controller.topAnalogs({ tenantId: 'tenant-1', period: '2026-08', limit: 10 })

    expect(execute).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', period: '2026-08', limit: 10 })
    expect(response.data).toEqual([
      { medicineId: 'med-1', medicineName: 'Панадол', avgSavingsDiram: 2_000, timesShown: 50, conversionToOrder: 0.1 },
    ])
    expect(typeof response.data[0]?.avgSavingsDiram).toBe('number')
  })

  it('АС3 — пустой отчёт → пустой массив, не ошибка', async () => {
    const execute = vi.fn<GetTopAnalogsReportUseCase['execute']>().mockResolvedValue([])
    const controller = buildController(execute)

    const response = await controller.topAnalogs({ tenantId: 'tenant-1', period: '2026-08', limit: 10 })

    expect(response.data).toEqual([])
  })
})

describe('AnalyticsReportsController.onboardingFunnel (DTJ-384)', () => {
  it('маппит query в GetOnboardingFunnelUseCase.execute() и отдаёт обе группы решения', async () => {
    const result: GetOnboardingFunnelResult = [
      { decision: 'approved', averageDurationHours: 30, count: 7 },
      { decision: 'rejected', averageDurationHours: 12, count: 3 },
    ]
    const execute = vi.fn<GetOnboardingFunnelUseCase['execute']>().mockResolvedValue(result)
    const controller = buildController(undefined, execute)

    const response = await controller.onboardingFunnel({ tenantId: 'tenant-1', period: '2026-08' })

    expect(execute).toHaveBeenCalledExactlyOnceWith({ tenantId: 'tenant-1', period: '2026-08' })
    expect(response.data).toEqual(result)
  })

  it('АС3 — период без решённых заявок → пустой массив', async () => {
    const execute = vi.fn<GetOnboardingFunnelUseCase['execute']>().mockResolvedValue([])
    const controller = buildController(undefined, execute)

    const response = await controller.onboardingFunnel({ tenantId: 'tenant-1', period: '2026-08' })

    expect(response.data).toEqual([])
  })
})
