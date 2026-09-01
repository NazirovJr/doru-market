/**
 * `NullOrdersCancellationAdapter` (DTJ-071) — ВРЕМЕННАЯ null-реализация
 * `OrdersCancellationPort`. Не отменяет реальные заказы до готовности EP-10.
 *
 * TODO(EP-10): заменить на реальный адаптер модуля `orders`, который
 * использует `PaymentProvider` для рефанда (SRS-DOM-161).
 */
import { Injectable, Logger } from '@nestjs/common'
import type {
  ForceCancelResult,
  OrdersCancellationPort,
} from '@/modules/onboarding/application/ports/orders-cancellation.port.js'

@Injectable()
export class NullOrdersCancellationAdapter implements OrdersCancellationPort {
  private readonly logger = new Logger(NullOrdersCancellationAdapter.name)

  forceCancelIncomplete(_pharmacyId: string, reason: string): Promise<ForceCancelResult> {
    this.logger.warn(`orders_cancellation_not_wired: reason=${reason}`)
    return Promise.resolve({ cancelledOrderIds: [] })
  }
}
