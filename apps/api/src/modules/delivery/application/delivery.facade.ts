import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError } from '@dorutj/contracts'
import { CLOCK, type Clock } from '@/shared-kernel/index.js'
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
import { CalculateDeliveryFeeUseCase, type CalculateDeliveryFeeInput } from './use-cases/calculate-delivery-fee.use-case.js'
import {
  ProvisionCourierUseCase,
  type ProvisionCourierInput,
  type CourierProvisionSnapshot,
} from './use-cases/provision-courier.use-case.js'
import { ReturnTripService, type ReturnCourierAssignment, type ReturnTripInput } from './services/return-trip.service.js'

export type { CalculateDeliveryFeeInput, ProvisionCourierInput, CourierProvisionSnapshot, ReturnCourierAssignment, ReturnTripInput }

export interface CreateDeliveryAssignmentInput {
  readonly id: string
  readonly orderId: string
  readonly landmarkText: string | null
  readonly requiresColdChain: boolean
}

export interface ReassignDeliveryInput {
  readonly assignmentId: string
  readonly newCourierId: string
  readonly reason: string
  readonly reassignedBy: string
}

@Injectable()
export class DeliveryFacade {
  // eslint-disable-next-line max-params -- 6 DI-инъекций, конструктор NestJS.
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CalculateDeliveryFeeUseCase) private readonly calculateFee: CalculateDeliveryFeeUseCase,
    @Inject(ProvisionCourierUseCase) private readonly provisionCourierUseCase: ProvisionCourierUseCase,
    @Inject(ReturnTripService) private readonly returnTrip: ReturnTripService,
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
    const courier = await this.getCourierOrThrow(input.newCourierId)
    assignment.reassign({
      newCourierId: courier.id,
      courierStatus: courier.status,
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

  /** SRS-DELIV-048 (DTJ-322) — делегирует резолюцию зоны/тарифа/ночной надбавки `CalculateDeliveryFeeUseCase`. */
  public async calculateDeliveryFee(input: CalculateDeliveryFeeInput): Promise<bigint> {
    return this.calculateFee.execute(input)
  }

  // DTJ-364: делегирует ProvisionCourierUseCase (идемпотентно) — единственная точка входа admin в delivery.
  public async provisionCourier(input: ProvisionCourierInput): Promise<CourierProvisionSnapshot> {
    return this.provisionCourierUseCase.execute(input)
  }

  public async calculateReturnFee(input: ReturnTripInput): Promise<bigint> {
    return this.returnTrip.calculateReturnFee(input)
  }

  public async suggestReturnCourier(input: ReturnTripInput): Promise<ReturnCourierAssignment | null> {
    return this.returnTrip.suggestReturnCourier(input)
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
