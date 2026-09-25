import { describe, expect, it, vi } from 'vitest'
import type { CatalogFacade } from '@/modules/catalog/index.js'
import type { ProductEventsRepositoryPort, TopAnalogSavingsRow } from '../ports/product-events-repository.port.js'
import { GetTopAnalogsReportUseCase } from './get-top-analogs-report.use-case.js'

function buildHarness(rows: readonly TopAnalogSavingsRow[] = []) {
  const getTopAnalogsBySavingsMock = vi.fn<ProductEventsRepositoryPort['getTopAnalogsBySavings']>().mockResolvedValue(rows)
  const repository = { getTopAnalogsBySavings: getTopAnalogsBySavingsMock } as unknown as ProductEventsRepositoryPort
  const getMedicineSnapshotMock = vi.fn<CatalogFacade['getMedicineSnapshot']>().mockResolvedValue(new Map())
  const catalogFacade = { getMedicineSnapshot: getMedicineSnapshotMock } as unknown as CatalogFacade
  const useCase = new GetTopAnalogsReportUseCase(repository, catalogFacade)
  return { useCase, getTopAnalogsBySavingsMock, getMedicineSnapshotMock }
}

describe('GetTopAnalogsReportUseCase', () => {
  it('АС1 — обогащает строку порта названием медикамента через CatalogFacade.getMedicineSnapshot', async () => {
    const { useCase, getMedicineSnapshotMock } = buildHarness([
      { medicineId: 'med-1', avgSavingsDiram: 2_000n, timesShown: 50, conversionToOrder: 0.1 },
    ])
    getMedicineSnapshotMock.mockResolvedValue(
      new Map([
        [
          'med-1',
          {
            medicineId: 'med-1',
            tradeName: 'Панадол',
            innName: 'Парацетамол',
            dosageForm: 'tablet',
            dosageStrength: '500mg',
            isPrescriptionRequired: false,
            controlCategory: 'none',
            requiresColdChain: false,
          },
        ],
      ]) as never,
    )

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result).toEqual([
      { medicineId: 'med-1', medicineName: 'Панадол', avgSavingsDiram: 2_000n, timesShown: 50, conversionToOrder: 0.1 },
    ])
  })

  it('АС2 — limit не передан → делегируется порту дефолт 10', async () => {
    const { useCase, getTopAnalogsBySavingsMock } = buildHarness()

    await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(getTopAnalogsBySavingsMock).toHaveBeenCalledExactlyOnceWith(
      'tenant-1',
      expect.objectContaining({ start: expect.any(Date) as Date, end: expect.any(Date) as Date }),
      10,
    )
  })

  it('АС3 — период без единого analog_shown → пустой массив, без обращения к CatalogFacade', async () => {
    const { useCase, getMedicineSnapshotMock } = buildHarness([])

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result).toEqual([])
    expect(getMedicineSnapshotMock).not.toHaveBeenCalled()
  })

  it('несуществующий в каталоге medicineId → fallback на id, не бросает', async () => {
    const { useCase } = buildHarness([
      { medicineId: 'med-missing', avgSavingsDiram: 1_000n, timesShown: 5, conversionToOrder: 0 },
    ])

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result[0]?.medicineName).toBe('med-missing')
  })
})
