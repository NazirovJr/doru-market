import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError, type UserRole } from '@dorutj/contracts'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import { MASKED_CALLING_PORT, type MaskedCallingPort } from '../ports/masked-calling.port.js'

export interface DetailActor {
  readonly userId: string
  readonly role: UserRole
  readonly tenantId: string | null
  readonly pharmacyId: string | null
  readonly chainId: string | null
}

export interface GetDeliveryAssignmentDetailCommand {
  readonly assignmentId: string
  readonly actor: DetailActor
}

export interface DeliveryAssignmentDetailView {
  readonly id: string
  readonly orderId: string
  readonly status: string
  readonly courierId: string | null
  readonly requiresColdChain: boolean
  readonly paymentMethod: string
  readonly estimatedDeliveryFeeDiram: number
  readonly otpIssued: boolean
  readonly contactAttemptsCount: number
  readonly pharmacy: { readonly name: string; readonly addressText: string; readonly geoPoint: { readonly lat: number; readonly lon: number } }
  readonly customerAddress: {
    readonly addressText: string
    readonly landmarkText: string | null
    readonly landmarkPhotoUrl: string | null
    readonly entrance: string | null
    readonly floor: string | null
    readonly apartment: string | null
    readonly deliveryComment: string | null
  }
  readonly customerContact: { readonly phoneNumber: string | null; readonly isMasked: boolean } | null
  readonly courierEtaMinutes: number | null
}

@Injectable()
export class GetDeliveryAssignmentDetailUseCase {
  // eslint-disable-next-line max-params -- 5 DI-инъекций, явные @Inject
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
    @Inject(MASKED_CALLING_PORT) private readonly maskedCalling: MaskedCallingPort,
  ) {}

  public async execute(cmd: GetDeliveryAssignmentDetailCommand): Promise<DeliveryAssignmentDetailView> {
    const assignment = await this.assignments.findById(cmd.assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ resource: 'delivery_assignment', assignmentId: cmd.assignmentId })
    }
    const orderContext = await this.orders.getDeliveryContext(assignment.orderId)
    if (orderContext === null) {
      throw new NotFoundError({ resource: 'order', orderId: assignment.orderId })
    }
    if (assignment.status === 'unassigned') {
      throw new ForbiddenError('Delivery assignment details are unavailable before assignment', { assignmentId: cmd.assignmentId })
    }
    const pharmacy = await this.pharmacies.findById(orderContext.pharmacyId)
    await this.assertActorAllowed({ actor: cmd.actor, assignment, orderContext, pharmacyChainId: pharmacy?.chainId ?? null })

    const isCustomer = cmd.actor.role === 'customer'
    const customerContact = isCustomer ? null : await this.maskedCalling.getCustomerContact(orderContext.customerId)
    return buildDetailView({ assignment, orderContext, pharmacy, customerContact })
  }

  private async assertActorAllowed(input: {
    readonly actor: DetailActor
    readonly assignment: { readonly courierId: string | null }
    readonly orderContext: { readonly tenantId: string; readonly pharmacyId: string; readonly customerId: string }
    readonly pharmacyChainId: string | null
  }): Promise<void> {
    const { actor, assignment, orderContext, pharmacyChainId } = input
    if (actor.role === 'courier') {
      const courier = await this.couriers.findByUserId(actor.userId)
      if (assignment.courierId !== courier?.id) {
        throw new ForbiddenError('Delivery assignment does not belong to this courier', {})
      }
      return
    }
    if (actor.role === 'customer') {
      if (actor.userId !== orderContext.customerId) {
        throw new ForbiddenError('Delivery assignment does not belong to this customer', {})
      }
      return
    }
    this.assertStaffActorAllowed(actor, orderContext, pharmacyChainId)
  }

  private assertStaffActorAllowed(
    actor: DetailActor,
    orderContext: { readonly tenantId: string; readonly pharmacyId: string },
    pharmacyChainId: string | null,
  ): void {
    if (actor.role === 'super_admin') return
    if (actor.tenantId !== orderContext.tenantId) {
      throw new NotFoundError({ resource: 'delivery_assignment' })
    }
    if (actor.role === 'pharmacist' && actor.pharmacyId !== orderContext.pharmacyId) {
      throw new ForbiddenError('Delivery assignment does not belong to this pharmacist', {})
    }
    if (actor.role === 'pharmacy_admin' && (pharmacyChainId === null || pharmacyChainId !== actor.chainId)) {
      throw new ForbiddenError('Delivery assignment is outside this pharmacy_admin fleet', {})
    }
  }
}

function buildDetailView(input: {
  readonly assignment: { readonly id: string; readonly orderId: string; readonly status: string; readonly courierId: string | null; readonly handoverOtpId: string | null; readonly toSnapshot: () => { readonly requiresColdChain: boolean; readonly contactAttemptsCount: number } }
  readonly orderContext: { readonly paymentMethod: string; readonly deliveryFeeDiram: bigint; readonly deliveryAddress: string; readonly deliveryLandmark: string | null }
  readonly pharmacy: { readonly name: string; readonly addressText: string; readonly geoPoint: { readonly latitude: number; readonly longitude: number } } | null
  readonly customerContact: { readonly phoneNumber: string | null; readonly isMasked: boolean } | null
}): DeliveryAssignmentDetailView {
  const { assignment, orderContext, pharmacy, customerContact } = input
  const snapshot = assignment.toSnapshot()
  return {
    id: assignment.id,
    orderId: assignment.orderId,
    status: assignment.status,
    courierId: assignment.courierId,
    requiresColdChain: snapshot.requiresColdChain,
    paymentMethod: orderContext.paymentMethod,
    estimatedDeliveryFeeDiram: Number(orderContext.deliveryFeeDiram),
    otpIssued: assignment.handoverOtpId !== null,
    contactAttemptsCount: snapshot.contactAttemptsCount,
    pharmacy: {
      name: pharmacy?.name ?? '',
      addressText: pharmacy?.addressText ?? '',
      geoPoint: { lat: pharmacy?.geoPoint.latitude ?? 0, lon: pharmacy?.geoPoint.longitude ?? 0 },
    },
    customerAddress: {
      addressText: orderContext.deliveryAddress,
      landmarkText: orderContext.deliveryLandmark,
      landmarkPhotoUrl: null,
      entrance: null,
      floor: null,
      apartment: null,
      deliveryComment: null,
    },
    customerContact,
    courierEtaMinutes: null,
  }
}
