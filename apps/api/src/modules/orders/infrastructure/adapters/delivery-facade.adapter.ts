import { Inject, Injectable } from '@nestjs/common'
import { DeliveryFacade } from '@/modules/delivery/index.js'
import type { GeoPoint } from '@/shared-kernel/index.js'
import type { DeliveryFacadePort } from '@/modules/orders/application/ports/delivery-facade.port.js'

@Injectable()
export class DeliveryFacadeAdapter implements DeliveryFacadePort {
  public constructor(@Inject(DeliveryFacade) private readonly delivery: DeliveryFacade) {}

  public async calculateFee(pharmacyGeoPoint: GeoPoint, deliveryGeoPoint: GeoPoint): Promise<bigint> {
    return this.delivery.calculateDeliveryFee(pharmacyGeoPoint, deliveryGeoPoint)
  }
}
