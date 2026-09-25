import { Inject, Injectable } from '@nestjs/common'
import { DeliveryFacade } from '@/modules/delivery/index.js'
import type { CalculateDeliveryFeeQuery, DeliveryFacadePort } from '@/modules/orders/application/ports/delivery-facade.port.js'

@Injectable()
export class DeliveryFacadeAdapter implements DeliveryFacadePort {
  public constructor(@Inject(DeliveryFacade) private readonly delivery: DeliveryFacade) {}

  public async calculateFee(query: CalculateDeliveryFeeQuery): Promise<bigint> {
    return this.delivery.calculateDeliveryFee({
      pharmacyGeoPoint: query.pharmacyGeoPoint,
      customerGeoPoint: query.deliveryGeoPoint,
      tenantId: query.tenantId,
      itemsTotalDiram: query.itemsTotalDiram,
    })
  }
}
