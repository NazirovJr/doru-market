import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ORDERS_CANCELLATION, type PharmacyOrdersCancellation } from '@/modules/orders/index.js'
import type {
  ForceCancelResult,
  OrdersCancellationPort,
} from '@/modules/onboarding/application/ports/orders-cancellation.port.js'

@Injectable()
export class OrdersCancellationAdapter implements OrdersCancellationPort {
  public constructor(@Inject(PHARMACY_ORDERS_CANCELLATION) private readonly orders: PharmacyOrdersCancellation) {}

  // Свободный текст причины пишется в журнал онбординга; в заказе причина — канонический enum.
  public async forceCancelIncomplete(pharmacyId: string, _reason: string): Promise<ForceCancelResult> {
    const { cancelledOrderIds, failedOrderIds } = await this.orders.execute(pharmacyId)
    if (failedOrderIds.length > 0) {
      throw new Error(`force-cancel incomplete: orders not cancelled, retry: ${failedOrderIds.join(',')}`)
    }
    return { cancelledOrderIds }
  }
}
