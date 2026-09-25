import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import type { CatalogFacade } from '@/modules/catalog/index.js'
import type { MedicineSnapshot } from '@/modules/catalog/domain/medicine.types.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '../ports/delivery-orders.port.js'
import type { PharmacyLocation, PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import { BuildCourierCandidateQueryService } from './build-courier-candidate-query.service.js'

const ORDER_ID = 'order-1'
const PHARMACY_ID = 'pharmacy-1'

function geo(): GeoPoint {
  const result = GeoPoint.create(38.5598, 68.787)
  if (!result.ok) throw new Error('fixture error')
  return result.value
}

function makeOrderContext(medicineIds: readonly string[]): DeliveryOrderContext {
  return { orderId: ORDER_ID, tenantId: 'tenant-1', pharmacyId: PHARMACY_ID, medicineIds, itemsCount: 1, paymentMethod: 'cash_courier', deliveryGeoPoint: null, deliveryFeeDiram: 1000n }
}

function makeMedicineSnapshot(overrides: Partial<MedicineSnapshot> = {}): MedicineSnapshot {
  return {
    medicineId: 'med-1',
    tradeName: 'Test',
    innName: 'Test',
    dosageForm: 'tablet',
    dosageStrength: '500 mg',
    isPrescriptionRequired: false,
    controlCategory: 'none' as MedicineSnapshot['controlCategory'],
    requiresColdChain: false,
    ...overrides,
  }
}

function makeService(params: {
  order?: DeliveryOrderContext | null
  pharmacy?: PharmacyLocation | null
  medicineSnapshots?: Map<string, MedicineSnapshot>
}): BuildCourierCandidateQueryService {
  const orders: DeliveryOrdersPort = {
    getOrderForRating: vi.fn().mockResolvedValue(null),
    getDeliveryContext: vi.fn().mockResolvedValue(params.order === undefined ? makeOrderContext(['med-1']) : params.order),
  }
  const pharmacy: PharmacyLocation = { id: PHARMACY_ID, name: 'P', addressText: 'A', geoPoint: geo(), chainId: 'chain-1' }
  const pharmacies: PharmacyLookupPort = { findById: vi.fn().mockResolvedValue(params.pharmacy === undefined ? pharmacy : params.pharmacy) }
  const catalog = {
    getMedicineSnapshot: vi.fn().mockResolvedValue(params.medicineSnapshots ?? new Map([['med-1', makeMedicineSnapshot()]])),
  } as unknown as CatalogFacade
  return new BuildCourierCandidateQueryService(orders, pharmacies, catalog)
}

describe('BuildCourierCandidateQueryService', () => {
  it('собирает candidateQuery из order+pharmacy, requiresColdChain=false когда ни один препарат не требует', async () => {
    const service = makeService({})

    const context = await service.execute(ORDER_ID)

    expect(context.requiresColdChain).toBe(false)
    expect(context.candidateQuery).toEqual({ tenantId: 'tenant-1', pharmacyChainId: 'chain-1', pharmacyGeoPoint: geo(), requiresColdChain: false })
  })

  it('requiresColdChain=true если ХОТЯ БЫ один препарат заказа требует холодовой цепи (OR)', async () => {
    const snapshots = new Map([
      ['med-1', makeMedicineSnapshot({ medicineId: 'med-1', requiresColdChain: false })],
      ['med-2', makeMedicineSnapshot({ medicineId: 'med-2', requiresColdChain: true })],
    ])
    const service = makeService({ order: makeOrderContext(['med-1', 'med-2']), medicineSnapshots: snapshots })

    const context = await service.execute(ORDER_ID)

    expect(context.requiresColdChain).toBe(true)
  })

  it('заказ не найден -> NotFoundError', async () => {
    const service = makeService({ order: null })

    await expect(service.execute(ORDER_ID)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('аптека не найдена -> NotFoundError', async () => {
    const service = makeService({ pharmacy: null })

    await expect(service.execute(ORDER_ID)).rejects.toBeInstanceOf(NotFoundError)
  })
})
