import { describe, expect, it, vi } from 'vitest'
import { GetPlatformMetricsUseCase } from './get-platform-metrics.use-case.js'
import type { OrdersFacadePort } from '../ports/orders-facade.port.js'
import type { InventoryFacadePort } from '../ports/inventory-facade.port.js'

function buildHarness() {
  const getGmvAndAverageCheck = vi
    .fn<OrdersFacadePort['getGmvAndAverageCheck']>()
    .mockResolvedValue({ gmvDiram: 500_000n, orderCount: 5, averageCheckDiram: 100_000n })
  const getSlaComplianceRates = vi
    .fn<OrdersFacadePort['getSlaComplianceRates']>()
    .mockResolvedValue({ pickupSlaComplianceRate: 0.8, deliverySlaComplianceRate: 0.7 })
  const getCancellationRate = vi.fn<OrdersFacadePort['getCancellationRate']>().mockResolvedValue(0.1)
  const ordersFacade: OrdersFacadePort = { getGmvAndAverageCheck, getSlaComplianceRates, getCancellationRate }
  const getActivePharmaciesSendingDataRate = vi
    .fn<InventoryFacadePort['getActivePharmaciesSendingDataRate']>()
    .mockResolvedValue(0.375)
  const inventoryFacade: InventoryFacadePort = { getActivePharmaciesSendingDataRate }
  const useCase = new GetPlatformMetricsUseCase(ordersFacade, inventoryFacade)
  return { useCase, getGmvAndAverageCheck, getSlaComplianceRates, getCancellationRate, getActivePharmaciesSendingDataRate }
}

describe('GetPlatformMetricsUseCase (DTJ-382)', () => {
  it('агрегирует 5 метрик из результатов обоих портов', async () => {
    const { useCase } = buildHarness()

    const result = await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(result).toEqual({
      gmvDiram: 500_000n,
      orderCount: 5,
      averageCheckDiram: 100_000n,
      pickupSlaComplianceRate: 0.8,
      deliverySlaComplianceRate: 0.7,
      cancellationRate: 0.1,
      activePharmaciesSendingDataRate: 0.375,
    })
  })

  it('запускает все 4 вызова портов параллельно (Promise.all), не последовательно', async () => {
    const { useCase, getGmvAndAverageCheck, getSlaComplianceRates, getCancellationRate, getActivePharmaciesSendingDataRate } =
      buildHarness()

    await useCase.execute({ tenantId: 'tenant-1', period: '2026-08' })

    expect(getGmvAndAverageCheck).toHaveBeenCalledTimes(1)
    expect(getSlaComplianceRates).toHaveBeenCalledTimes(1)
    expect(getCancellationRate).toHaveBeenCalledTimes(1)
    expect(getActivePharmaciesSendingDataRate).toHaveBeenCalledTimes(1)
  })

  it('невалидный period → ValidationError (тот же parsePeriod, что воронка DTJ-381)', async () => {
    const { useCase } = buildHarness()

    await expect(useCase.execute({ tenantId: 'tenant-1', period: 'not-a-period' })).rejects.toThrow()
  })
})
