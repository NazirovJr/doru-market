// Тот же приём, что onboarding/orders/payments-facade.adapter.ts — тонкий адаптер поверх РЕАЛЬНОГО фасада, не репозитория.
import { Inject, Injectable } from '@nestjs/common'
import { DeliveryFacade } from '@/modules/delivery/index.js'
import {
  DELIVERY_FACADE_PORT,
  type CourierSummaryView,
  type ProvisionCourierFacadeCommand,
  type DeliveryFacadePort,
} from '@/modules/admin/application/ports/delivery-facade.port.js'

@Injectable()
export class DeliveryFacadeAdapter implements DeliveryFacadePort {
  public constructor(@Inject(DeliveryFacade) private readonly deliveryFacade: DeliveryFacade) {}

  public async provisionCourier(command: ProvisionCourierFacadeCommand): Promise<CourierSummaryView> {
    return this.deliveryFacade.provisionCourier(command)
  }
}

export const DELIVERY_FACADE_PORT_PROVIDER = {
  provide: DELIVERY_FACADE_PORT,
  useClass: DeliveryFacadeAdapter,
} as const
