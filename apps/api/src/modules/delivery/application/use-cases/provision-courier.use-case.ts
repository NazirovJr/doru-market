// DTJ-364: создаёт delivery.couriers для существующей identity, идемпотентно (find-or-create по userId).
import { Inject, Injectable } from '@nestjs/common'
import type { CourierTaxStatus, CourierVehicleType } from '@dorutj/contracts'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import { Courier } from '../../domain/courier.entity.js'
import { COURIER_REPOSITORY, type CourierRepositoryPort } from '../ports/courier.repository.port.js'

const DEFAULT_VEHICLE_TYPE: CourierVehicleType = 'foot'
const DEFAULT_TAX_STATUS: CourierTaxStatus = 'chain_employee'

export interface ProvisionCourierInput {
  readonly userId: string
  readonly chainId: string
}

export interface CourierProvisionSnapshot {
  readonly id: string
  readonly userId: string
  readonly chainId: string | null
  readonly vehicleType: CourierVehicleType
  readonly taxStatus: CourierTaxStatus
}

@Injectable()
export class ProvisionCourierUseCase {
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async execute(input: ProvisionCourierInput): Promise<CourierProvisionSnapshot> {
    const existing = await this.couriers.findByUserId(input.userId)
    if (existing !== null) {
      return toSnapshot(existing)
    }
    const courier = Courier.create({
      id: this.ids.next(),
      userId: input.userId,
      chainId: input.chainId,
      taxStatus: DEFAULT_TAX_STATUS, // допущение: тикет не специфицирует сбор этих полей у pharmacy_admin
      vehicleType: DEFAULT_VEHICLE_TYPE,
      now: this.clock.now(),
    })
    await this.couriers.save(courier)
    return toSnapshot(courier)
  }
}

function toSnapshot(courier: Courier): CourierProvisionSnapshot {
  return {
    id: courier.id,
    userId: courier.props.userId,
    chainId: courier.chainId,
    vehicleType: courier.props.vehicleType,
    taxStatus: courier.props.taxStatus,
  }
}
