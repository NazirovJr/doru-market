// CalculateOrderCostService (DTJ-228/DTJ-358) — unit поверх мока DeliveryFacadePort; сервис читает commissionBps из уже резолвленной карты, сам в БД не ходит (см. JSDoc сервиса).
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { DeliveryFacadePort } from '@/modules/orders/application/ports/delivery-facade.port.js'
import type { CommissionCategory } from '@/modules/orders/application/ports/tenancy-facade.port.js'
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
  readonly calculateFee: ReturnType<typeof vi.fn<DeliveryFacadePort['calculateFee']>>
}

function makeHarness(): Harness {
  const calculateFee = vi.fn<DeliveryFacadePort['calculateFee']>().mockResolvedValue(1_500n)
  const deliveryFacade: DeliveryFacadePort = { calculateFee }
  return { service: new CalculateOrderCostService(deliveryFacade), calculateFee }
}

function ratesByCategory(rates: Partial<Record<CommissionCategory, number>>): ReadonlyMap<CommissionCategory, number> {
  return new Map(Object.entries(rates) as [CommissionCategory, number][])
}

function baseInput(overrides: Partial<CalculateOrderCostInput> = {}): CalculateOrderCostInput {
  return {
    tenantId: TENANT_ID,
    chainId: null,
    items: [lineItem()],
    pharmacyGeoPoint: PHARMACY_GEO,
    deliveryGeoPoint: DELIVERY_GEO,
    commissionRatesByCategory: ratesByCategory({ otc: 0 }),
    ...overrides,
  }
}

describe('CalculateOrderCostService (DTJ-228/DTJ-358)', () => {
  it('AC1 — позиции разных категорий несут СВОЙ platformFeeDiram (не общий на сумму) — берётся из своей записи карты', async () => {
    const { service } = makeHarness()
    const items = [
      lineItem({ medicineId: 'med-rx', unitPriceDiram: 10_000n, quantity: 1, isPrescriptionRequired: true }),
      lineItem({ medicineId: 'med-otc', unitPriceDiram: 10_000n, quantity: 1, isPrescriptionRequired: false }),
    ]
    const result = await service.calculate(baseInput({ items, commissionRatesByCategory: ratesByCategory({ rx: 500, otc: 800 }) }))

    expect(result.items).toHaveLength(2)
    const byMedicine = new Map(result.items.map((i) => [i.medicineId, i]))
    expect(byMedicine.get('med-rx')).toMatchObject({ commissionBps: 500, platformFeeDiram: 500n }) // 10000*500/10000
    expect(byMedicine.get('med-otc')).toMatchObject({ commissionBps: 800, platformFeeDiram: 800n })
  })

  it('АС3 регресс-фикс DTJ-358 — категория без записи в карте бросает, не подставляет правдоподобное значение', async () => {
    const { service } = makeHarness()
    const items = [lineItem({ isPrescriptionRequired: true })] // 'rx', карта несёт только 'otc'
    await expect(service.calculate(baseInput({ items, commissionRatesByCategory: ratesByCategory({ otc: 800 }) }))).rejects.toThrow(
      /no pre-resolved commission rate/,
    )
  })

  it('AC2 — мутация deliveryFee (через DeliveryFacadePort) НЕ влияет ни на одно platformFeeDiram', async () => {
    const { service, calculateFee } = makeHarness()
    const items = [lineItem({ unitPriceDiram: 10_000n, quantity: 2 })] // itemsTotal=20000, commission 500bps→1000
    const rates = ratesByCategory({ otc: 500 })

    calculateFee.mockResolvedValueOnce(1_500n)
    const first = await service.calculate(baseInput({ items, commissionRatesByCategory: rates }))

    calculateFee.mockResolvedValueOnce(99_999n) // сильно другая доставка
    const second = await service.calculate(baseInput({ items, commissionRatesByCategory: rates }))

    expect(first.items[0]?.platformFeeDiram).toBe(1_000n)
    expect(second.items[0]?.platformFeeDiram).toBe(1_000n)
    expect(first.deliveryFeeDiram).toBe(1_500n)
    expect(second.deliveryFeeDiram).toBe(99_999n)
    expect(first.totalAmountDiram).toBe(20_000n + 1_500n)
    expect(second.totalAmountDiram).toBe(20_000n + 99_999n)
  })

  it('itemsTotalDiram = Σ(unitPrice × quantity), totalAmountDiram = itemsTotal + deliveryFee', async () => {
    const { service } = makeHarness()
    const items = [
      lineItem({ unitPriceDiram: 10_000n, quantity: 2 }), // 20000
      lineItem({ unitPriceDiram: 5_000n, quantity: 3 }), // 15000
    ]
    const result = await service.calculate(baseInput({ items, commissionRatesByCategory: ratesByCategory({ otc: 500 }) }))
    expect(result.itemsTotalDiram).toBe(35_000n)
    expect(result.totalAmountDiram).toBe(35_000n + result.deliveryFeeDiram)
  })

  it('pharmacyGeoPoint === null — DeliveryFacadePort.calculateFee НЕ вызывается, deliveryFeeDiram = 0', async () => {
    const { service, calculateFee } = makeHarness()
    const result = await service.calculate(baseInput({ pharmacyGeoPoint: null, commissionRatesByCategory: ratesByCategory({ otc: 500 }) }))
    expect(calculateFee).not.toHaveBeenCalled()
    expect(result.deliveryFeeDiram).toBe(0n)
  })

  it('deliveryGeoPoint === null — DeliveryFacadePort.calculateFee НЕ вызывается, deliveryFeeDiram = 0', async () => {
    const { service, calculateFee } = makeHarness()
    const result = await service.calculate(baseInput({ deliveryGeoPoint: null, commissionRatesByCategory: ratesByCategory({ otc: 500 }) }))
    expect(calculateFee).not.toHaveBeenCalled()
    expect(result.deliveryFeeDiram).toBe(0n)
  })
})
