/**
 * `CalculateOrderCostService` (EP-09, DTJ-228) — unit-набор поверх моков `TenancyFacadePort`/
 * `DeliveryFacadePort`. Банковское округление НА КАЖДУЮ позицию (граничные `x.5` случаи) уже
 * покрыто `order-item.entity.spec.ts` (сервис ПЕРЕИСПОЛЬЗУЕТ `OrderItem.create()`, не
 * дублирует формулу, см. JSDoc сервиса) — здесь проверяется ТОЛЬКО собственная ответственность
 * сервиса: резолвинг `commissionBps` на позицию, независимость комиссии от `deliveryFee`
 * (SRS-DOM-009), и агрегация итогов.
 */
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { DeliveryFacadePort } from '@/modules/orders/application/ports/delivery-facade.port.js'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import {
  CalculateOrderCostService,
  type CalculateOrderCostInput,
  type OrderCostLineInput,
} from './calculate-order-cost.service.js'

const TENANT_ID = 'tenant-1'

function geoPointOrThrow(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!result.ok) throw new Error('fixture: invalid GeoPoint')
  return result.value
}

const PHARMACY_GEO = geoPointOrThrow(38.5598, 68.787)
const DELIVERY_GEO = geoPointOrThrow(38.56, 68.79)

function lineItem(overrides: Partial<OrderCostLineInput> = {}): OrderCostLineInput {
  return {
    medicineId: randomUUID(),
    unitPriceDiram: 10_000n,
    quantity: 1,
    isPrescriptionRequired: false,
    ...overrides,
  }
}

interface Harness {
  readonly service: CalculateOrderCostService
  readonly resolveCommissionRate: ReturnType<typeof vi.fn<TenancyFacadePort['resolveCommissionRate']>>
  readonly calculateFee: ReturnType<typeof vi.fn<DeliveryFacadePort['calculateFee']>>
}

function makeHarness(commissionByCategory: Partial<Record<'rx' | 'otc', number>> = {}): Harness {
  const resolveCommissionRate = vi
    .fn<TenancyFacadePort['resolveCommissionRate']>()
    .mockImplementation((_tenantId, _chainId, category) =>
      Promise.resolve(commissionByCategory[category as 'rx' | 'otc'] ?? 0),
    )
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate,
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes: vi.fn(),
  }
  const calculateFee = vi.fn<DeliveryFacadePort['calculateFee']>().mockResolvedValue(1_500n)
  const deliveryFacade: DeliveryFacadePort = { calculateFee }
  return { service: new CalculateOrderCostService(tenancyFacade, deliveryFacade), resolveCommissionRate, calculateFee }
}

function baseInput(overrides: Partial<CalculateOrderCostInput> = {}): CalculateOrderCostInput {
  return {
    tenantId: TENANT_ID,
    chainId: null,
    items: [lineItem()],
    pharmacyGeoPoint: PHARMACY_GEO,
    deliveryGeoPoint: DELIVERY_GEO,
    ...overrides,
  }
}

describe('CalculateOrderCostService (DTJ-228)', () => {
  it('AC1 — 3 позиции с разными commissionBps несут СВОЙ platformFeeDiram (не общий на сумму); значения совпадают с реальными SRS-DOM-160 (rx=500/otc=800/parapharma=1200, TenancyFacadeAdapter.spec.ts)', async () => {
    const { service, resolveCommissionRate } = makeHarness()
    resolveCommissionRate.mockResolvedValueOnce(500).mockResolvedValueOnce(800).mockResolvedValueOnce(1200)
    const items = [
      lineItem({ medicineId: 'med-a', unitPriceDiram: 10_000n, quantity: 1 }),
      lineItem({ medicineId: 'med-b', unitPriceDiram: 10_000n, quantity: 1 }),
      lineItem({ medicineId: 'med-c', unitPriceDiram: 10_000n, quantity: 1 }),
    ]
    const result = await service.calculate(baseInput({ items }))

    expect(result.items).toHaveLength(3)
    const byMedicine = new Map(result.items.map((i) => [i.medicineId, i]))
    expect(byMedicine.get('med-a')).toMatchObject({ commissionBps: 500, platformFeeDiram: 500n }) // 10000*500/10000
    expect(byMedicine.get('med-b')).toMatchObject({ commissionBps: 800, platformFeeDiram: 800n })
    expect(byMedicine.get('med-c')).toMatchObject({ commissionBps: 1200, platformFeeDiram: 1200n })
  })

  it('AC2 — мутация deliveryFee (через DeliveryFacadePort) НЕ влияет ни на одно platformFeeDiram', async () => {
    const { service, calculateFee } = makeHarness({ otc: 500 })
    const items = [lineItem({ unitPriceDiram: 10_000n, quantity: 2 })] // itemsTotal=20000, commission 500bps→1000

    calculateFee.mockResolvedValueOnce(1_500n)
    const first = await service.calculate(baseInput({ items }))

    calculateFee.mockResolvedValueOnce(99_999n) // сильно другая доставка
    const second = await service.calculate(baseInput({ items }))

    expect(first.items[0]?.platformFeeDiram).toBe(1_000n)
    expect(second.items[0]?.platformFeeDiram).toBe(1_000n)
    expect(first.deliveryFeeDiram).toBe(1_500n)
    expect(second.deliveryFeeDiram).toBe(99_999n)
    expect(first.totalAmountDiram).toBe(20_000n + 1_500n)
    expect(second.totalAmountDiram).toBe(20_000n + 99_999n)
  })

  it('itemsTotalDiram = Σ(unitPrice × quantity), totalAmountDiram = itemsTotal + deliveryFee', async () => {
    const { service } = makeHarness({ otc: 500 })
    const items = [
      lineItem({ unitPriceDiram: 10_000n, quantity: 2 }), // 20000
      lineItem({ unitPriceDiram: 5_000n, quantity: 3 }), // 15000
    ]
    const result = await service.calculate(baseInput({ items }))
    expect(result.itemsTotalDiram).toBe(35_000n)
    expect(result.totalAmountDiram).toBe(35_000n + result.deliveryFeeDiram)
  })

  it('isPrescriptionRequired=true резолвит категорию "rx", false — "otc"', async () => {
    const { service, resolveCommissionRate } = makeHarness({ rx: 1000, otc: 300 })
    const items = [
      lineItem({ medicineId: 'rx-med', isPrescriptionRequired: true }),
      lineItem({ medicineId: 'otc-med', isPrescriptionRequired: false }),
    ]
    await service.calculate(baseInput({ items }))

    expect(resolveCommissionRate).toHaveBeenCalledWith(TENANT_ID, null, 'rx')
    expect(resolveCommissionRate).toHaveBeenCalledWith(TENANT_ID, null, 'otc')
  })

  it('pharmacyGeoPoint === null — DeliveryFacadePort.calculateFee НЕ вызывается, deliveryFeeDiram = 0', async () => {
    const { service, calculateFee } = makeHarness({ otc: 500 })
    const result = await service.calculate(baseInput({ pharmacyGeoPoint: null }))
    expect(calculateFee).not.toHaveBeenCalled()
    expect(result.deliveryFeeDiram).toBe(0n)
  })

  it('deliveryGeoPoint === null — DeliveryFacadePort.calculateFee НЕ вызывается, deliveryFeeDiram = 0', async () => {
    const { service, calculateFee } = makeHarness({ otc: 500 })
    const result = await service.calculate(baseInput({ deliveryGeoPoint: null }))
    expect(calculateFee).not.toHaveBeenCalled()
    expect(result.deliveryFeeDiram).toBe(0n)
  })
})
