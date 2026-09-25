import { describe, expect, it, vi } from 'vitest'
import type { GetTopAnalogsReportUseCase, GetTopAnalogsReportResult } from '../application/use-cases/get-top-analogs-report.use-case.js'
import { AnalyticsReportsController } from './analytics-reports.controller.js'

function baseTopAnalogsResult(): GetTopAnalogsReportResult {
  return [{ medicineId: 'med-1', medicineName: 'Панадол', avgSavingsDiram: 2_000n, timesShown: 50, conversionToOrder: 0.1 }]
}

function buildController(
  topAnalogsExecute: GetTopAnalogsReportUseCase['execute'] = vi.fn(),
): AnalyticsReportsController {
  return new AnalyticsReportsController({ execute: topAnalogsExecute } as unknown as GetTopAnalogsReportUseCase)
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
