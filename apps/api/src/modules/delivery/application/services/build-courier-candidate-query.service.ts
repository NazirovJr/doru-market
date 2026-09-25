import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CATALOG_FACADE, type CatalogFacade } from '@/modules/catalog/index.js'
import {
  DELIVERY_ORDERS_PORT,
  type DeliveryOrderContext,
  type DeliveryOrdersPort,
} from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLocation, type PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import type { SuggestNearestCourierInput } from '../use-cases/suggest-nearest-courier.use-case.js'

export interface AssignmentContext {
  readonly order: DeliveryOrderContext
  readonly pharmacy: PharmacyLocation
  readonly requiresColdChain: boolean
  readonly candidateQuery: SuggestNearestCourierInput
}

// Общий сбор входа SuggestNearestCourierUseCase из orderId — используется и при создании, и при эскалации (не дублируется).
@Injectable()
export class BuildCourierCandidateQueryService {
  public constructor(
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
    @Inject(CATALOG_FACADE) private readonly catalog: CatalogFacade,
  ) {}

  public async execute(orderId: string): Promise<AssignmentContext> {
    const order = await this.orders.getDeliveryContext(orderId)
    if (order === null) {
      throw new NotFoundError({ resource: 'order', orderId })
    }
    const pharmacy = await this.pharmacies.findById(order.pharmacyId)
    if (pharmacy === null) {
      throw new NotFoundError({ resource: 'pharmacy', pharmacyId: order.pharmacyId })
    }
    const requiresColdChain = await this.resolveRequiresColdChain(order.medicineIds)
    return {
      order,
      pharmacy,
      requiresColdChain,
      candidateQuery: {
        tenantId: order.tenantId,
        pharmacyChainId: pharmacy.chainId,
        pharmacyGeoPoint: pharmacy.geoPoint,
        requiresColdChain,
      },
    }
  }

  private async resolveRequiresColdChain(medicineIds: readonly string[]): Promise<boolean> {
    if (medicineIds.length === 0) return false
    const snapshots = await this.catalog.getMedicineSnapshot(medicineIds)
    return [...snapshots.values()].some((m) => m.requiresColdChain)
  }
}
