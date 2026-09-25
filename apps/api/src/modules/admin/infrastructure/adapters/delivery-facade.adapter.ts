// Узкий адаптер поверх COURIER_REPOSITORY (приём identity-facade.adapter.ts), не DeliveryFacade.
import { Inject, Injectable } from '@nestjs/common'
import { COURIER_REPOSITORY, Courier, type CourierRepositoryPort } from '@/modules/delivery/index.js'
import { CLOCK, ID_GENERATOR, type Clock, type IdGenerator } from '@/shared-kernel/index.js'
import {
  DELIVERY_FACADE_PORT,
  type CourierSummaryView,
  type CreateCourierFacadeCommand,
  type DeliveryFacadePort,
} from '@/modules/admin/application/ports/delivery-facade.port.js'

const DEFAULT_VEHICLE_TYPE = 'foot' // допущение: тикет не специфицирует сбор этих полей у pharmacy_admin
const DEFAULT_TAX_STATUS = 'chain_employee'

@Injectable()
export class DeliveryFacadeAdapter implements DeliveryFacadePort {
  public constructor(
    @Inject(COURIER_REPOSITORY) private readonly couriers: CourierRepositoryPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public async findCourierByUserId(userId: string): Promise<CourierSummaryView | null> {
    const courier = await this.couriers.findByUserId(userId)
    return courier === null ? null : toSummaryView(courier)
  }

  public async createCourier(command: CreateCourierFacadeCommand): Promise<CourierSummaryView> {
    const courier = Courier.create({
      id: this.ids.next(),
      userId: command.userId,
      chainId: command.chainId,
      taxStatus: DEFAULT_TAX_STATUS,
      vehicleType: DEFAULT_VEHICLE_TYPE,
      now: this.clock.now(),
    })
    await this.couriers.save(courier)
    return toSummaryView(courier)
  }
}

function toSummaryView(courier: Courier): CourierSummaryView {
  return {
    id: courier.id,
    userId: courier.props.userId,
    chainId: courier.chainId,
    vehicleType: courier.props.vehicleType,
    taxStatus: courier.props.taxStatus,
  }
}

export const DELIVERY_FACADE_PORT_PROVIDER = {
  provide: DELIVERY_FACADE_PORT,
  useClass: DeliveryFacadeAdapter,
} as const
