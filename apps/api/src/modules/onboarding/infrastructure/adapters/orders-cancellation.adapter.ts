import { Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_ORDERS_CANCELLATION,
  type PharmacyOrdersCancellation,
  type PharmacyOrdersCancellationResult,
  type PharmacyOrdersCancellationScope,
} from '@/modules/orders/index.js'
import type {
  ForceCancelResult,
  OrdersCancellationPort,
} from '@/modules/onboarding/application/ports/orders-cancellation.port.js'

@Injectable()
export class OrdersCancellationAdapter implements OrdersCancellationPort {
  public constructor(@Inject(PHARMACY_ORDERS_CANCELLATION) private readonly orders: PharmacyOrdersCancellation) {}

  public async forceCancelIncomplete(pharmacyId: string, _reason: string): Promise<ForceCancelResult> {
    return this.cancel(pharmacyId, 'all')
  }

  public async cancelUnpaid(pharmacyId: string): Promise<ForceCancelResult> {
    return this.cancel(pharmacyId, 'unpaid')
  }

  private async cancel(pharmacyId: string, scope: PharmacyOrdersCancellationScope): Promise<ForceCancelResult> {
    const { cancelledOrderIds, failedOrderIds }: PharmacyOrdersCancellationResult = await this.orders.execute(pharmacyId, scope)
    if (failedOrderIds.length > 0) {
      throw new Error(`pharmacy orders cancellation: orders not cancelled, retry: ${failedOrderIds.join(',')}`)
    }
    return { cancelledOrderIds }
  }
}
