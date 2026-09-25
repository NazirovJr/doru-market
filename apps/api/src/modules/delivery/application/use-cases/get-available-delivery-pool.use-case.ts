// Тенантный/cold-chain guard применяется здесь к фильтрации списка, не только к claim.
import { Inject, Injectable } from '@nestjs/common'
import { CourierNotOnShiftError, NotFoundError } from '@dorutj/contracts'
import type { GeoPoint } from '@/shared-kernel/index.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLookupPort, type PharmacyLocation } from '../ports/pharmacy-lookup.port.js'
import type { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'
import type { Courier } from '../../domain/courier.entity.js'

const METERS_PER_KM = 1000

export interface AvailablePoolItemView {
  readonly deliveryAssignmentId: string
  readonly distanceMeters: number
  readonly pharmacy: { readonly name: string; readonly addressText: string; readonly geoPoint: GeoPoint }
  readonly orderSummary: { readonly itemsCount: number; readonly requiresColdChain: boolean; readonly paymentMethod: string; readonly estimatedDeliveryFeeDiram: number }
}

export interface GetAvailableDeliveryPoolCommand {
  readonly userId: string
  readonly radiusKm: number
}

@Injectable()
export class GetAvailableDeliveryPoolUseCase {
  // eslint-disable-next-line max-params -- 4 DI-инъекции, явные @Inject
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
  ) {}

  public async execute(cmd: GetAvailableDeliveryPoolCommand): Promise<readonly AvailablePoolItemView[]> {
    const courier = await this.couriers.findByUserId(cmd.userId)
    if (courier === null) {
      throw new NotFoundError({ resource: 'courier', userId: cmd.userId })
    }
    if (courier.shiftStatus !== 'on_shift') {
      throw new CourierNotOnShiftError({ courierId: courier.id })
    }
    if (courier.lastKnownLocation === null) {
      return [] // нет свежей геопозиции — пул невозможно отсортировать/отфильтровать по радиусу
    }
    const courierPoint = courier.lastKnownLocation.point
    const pool = await this.assignments.findUnassignedPool()
    const items = await Promise.all(pool.map((assignment) => this.toEligibleItem(assignment, courier, courierPoint)))
    const radiusMeters = cmd.radiusKm * METERS_PER_KM
    return items
      .filter((item): item is AvailablePoolItemView => item !== null && item.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
  }

  private async toEligibleItem(assignment: DeliveryAssignment, courier: Courier, courierPoint: GeoPoint): Promise<AvailablePoolItemView | null> {
    const orderContext = await this.orders.getDeliveryContext(assignment.orderId)
    if (orderContext === null) {
      return null
    }
    const pharmacy = await this.pharmacies.findById(orderContext.pharmacyId)
    const snapshot = assignment.toSnapshot()
    if (pharmacy === null || !isEligible(courier, snapshot.requiresColdChain, pharmacy)) {
      return null
    }
    const distanceMeters = courierPoint.distanceTo(pharmacy.geoPoint)
    return {
      deliveryAssignmentId: assignment.id,
      distanceMeters,
      pharmacy: { name: pharmacy.name, addressText: pharmacy.addressText, geoPoint: pharmacy.geoPoint },
      orderSummary: {
        itemsCount: orderContext.itemsCount,
        requiresColdChain: snapshot.requiresColdChain,
        paymentMethod: orderContext.paymentMethod,
        estimatedDeliveryFeeDiram: Number(orderContext.deliveryFeeDiram),
      },
    }
  }
}

function isEligible(courier: Courier, requiresColdChain: boolean, pharmacy: PharmacyLocation): boolean {
  if (courier.chainId !== null && courier.chainId !== pharmacy.chainId) {
    return false
  }
  return !requiresColdChain || courier.coldChainCertified
}
