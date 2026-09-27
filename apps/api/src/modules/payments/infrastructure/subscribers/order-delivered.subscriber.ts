// handle() — стабильный вход, независимый от механизма доставки (сейчас — OrderDeliveredDomainEventHandler).
import { Inject, Injectable } from '@nestjs/common'
import { CaptureEscrowUseCase, type CaptureEscrowCommand } from '@/modules/payments/application/use-cases/capture-escrow.use-case.js'

export interface OrderDeliveredEventPayload {
  readonly tenantId: string
  readonly orderId: string
  readonly deliveredAt: Date
  readonly eventId: string
}

@Injectable()
export class OrderDeliveredSubscriber {
  constructor(@Inject(CaptureEscrowUseCase) private readonly captureEscrow: CaptureEscrowUseCase) {}

  async handle(event: OrderDeliveredEventPayload): Promise<void> {
    const cmd: CaptureEscrowCommand = { tenantId: event.tenantId, orderId: event.orderId, eventId: event.eventId }
    await this.captureEscrow.execute(cmd)
  }
}
