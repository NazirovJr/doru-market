import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock, type GeoPoint } from '@/shared-kernel/index.js'
import { DeliveryAssignment } from '../domain/delivery-assignment.entity.js'
import type { Courier } from '../domain/courier.entity.js'
import type { DeliveryAssignmentSnapshot } from '../domain/delivery-assignment-snapshot.js'
import {
  COURIER_REPOSITORY,
  type CourierRepositoryPort,
} from './ports/courier.repository.port.js'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from './ports/delivery-assignment.repository.port.js'

// TODO(DTJ-322): реальная формула по зонам/тарифам тенанта; override — DELIVERY_FEE_FIXED_STUB_DIRAM.
const FIXED_DELIVERY_FEE_STUB_DIRAM = 1000n

export interface CreateDeliveryAssignmentInput {
  readonly id: string
  readonly orderId: string
  readonly landmarkText: string | null
  readonly requiresColdChain: boolean
}

export interface ReturnCourierAssignment {
  readonly courierId: string
  readonly etaMinutes: number | null
}

export interface ReassignDeliveryInput {
  readonly assignmentId: string
  readonly newCourierId: string
  readonly reason: string
  readonly reassignedBy: string
}

@Injectable()
export class DeliveryFacade {
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async createAssignment(input: CreateDeliveryAssignmentInput): Promise<DeliveryAssignmentSnapshot> {
    const existing = await this.assignments.findActiveByOrderId(input.orderId)
    const result = DeliveryAssignment.create({
      id: input.id,
      orderId: input.orderId,
      landmarkText: input.landmarkText,
      requiresColdChain: input.requiresColdChain,
      hasActiveNonTerminalAssignment: existing !== null,
      now: this.clock.now(),
    })
    if (!result.ok) {
      throw result.error
    }
    await this.assignments.save(result.value)
    return result.value.toSnapshot()
  }

  public async assign(assignmentId: string, courierId: string, orderPharmacyChainId: string | null): Promise<void> {
    const assignment = await this.getAssignmentOrThrow(assignmentId)
    const courier = await this.getCourierOrThrow(courierId)
    assignment.assign({ courier: courier.toEligibilitySnapshot(), orderPharmacyChainId, now: this.clock.now() })
    await this.assignments.save(assignment)
  }

  public async reassign(input: ReassignDeliveryInput): Promise<void> {
    const assignment = await this.getAssignmentOrThrow(input.assignmentId)
    assignment.reassign({
      newCourierId: input.newCourierId,
      reason: input.reason,
      reassignedBy: input.reassignedBy,
      now: this.clock.now(),
    })
    await this.assignments.save(assignment)
  }

  public async hasActiveAssignment(orderId: string): Promise<boolean> {
    return (await this.assignments.findActiveByOrderId(orderId)) !== null
  }

  public async getActiveAssignment(orderId: string): Promise<DeliveryAssignmentSnapshot | null> {
    const assignment = await this.assignments.findActiveByOrderId(orderId)
    return assignment?.toSnapshot() ?? null
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async — контракт порта
  public async calculateDeliveryFee(_pharmacyGeoPoint: GeoPoint, _deliveryGeoPoint: GeoPoint): Promise<bigint> {
    const override = process.env.DELIVERY_FEE_FIXED_STUB_DIRAM
    if (override !== undefined && override.trim() !== '') {
      const parsed = BigInt(override)
      return parsed
    }
    return FIXED_DELIVERY_FEE_STUB_DIRAM
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async — контракт порта
  public async assignReturnCourier(_tenantId: string, _returnId: string): Promise<ReturnCourierAssignment | null> {
    return null
  }

  private async getAssignmentOrThrow(assignmentId: string): Promise<DeliveryAssignment> {
    const assignment = await this.assignments.findById(assignmentId)
    if (assignment === null) {
      throw new NotFoundError({ assignmentId })
    }
    return assignment
  }

  private async getCourierOrThrow(courierId: string): Promise<Courier> {
    const courier = await this.couriers.findById(courierId)
    if (courier === null) {
      throw new NotFoundError({ courierId })
    }
    return courier
  }
}
