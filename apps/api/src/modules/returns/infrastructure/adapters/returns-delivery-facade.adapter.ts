import { Inject, Injectable } from '@nestjs/common'
import { ErrorCode, NotFoundError } from '@dorutj/contracts'
import { DeliveryFacade } from '@/modules/delivery/index.js'
import {
  RETURNS_DELIVERY_PORT,
  type ReturnsCourierAssignment,
  type ReturnsDeliveryPort,
} from '@/modules/returns/application/ports/delivery-facade.port.js'
import { RETURNS_REPOSITORY, type ReturnsRepositoryPort } from '@/modules/returns/application/ports/returns-repository.port.js'

@Injectable()
export class ReturnsDeliveryFacadeAdapter implements ReturnsDeliveryPort {
  public constructor(
    @Inject(DeliveryFacade) private readonly delivery: DeliveryFacade,
    @Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort,
  ) {}

  public async assignReturnCourier(tenantId: string, returnId: string): Promise<ReturnsCourierAssignment | null> {
    const orderReturn = await this.repository.findById(returnId)
    if (orderReturn === null) {
      throw new NotFoundError({ returnId }, ErrorCode.RETURN_NOT_FOUND, 'Return not found')
    }
    return this.delivery.suggestReturnCourier({ tenantId, orderId: orderReturn.orderId })
  }

  public async calculateReturnFee(tenantId: string, orderId: string): Promise<bigint> {
    return this.delivery.calculateReturnFee({ tenantId, orderId })
  }
}

export const RETURNS_DELIVERY_FACADE_PROVIDER = {
  provide: RETURNS_DELIVERY_PORT,
  useClass: ReturnsDeliveryFacadeAdapter,
} as const
