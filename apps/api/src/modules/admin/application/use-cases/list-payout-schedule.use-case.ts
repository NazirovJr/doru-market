import { Inject, Injectable } from '@nestjs/common'
import {
  PAYMENTS_FACADE_PORT,
  type FinanceCursor,
  type FinancePage,
  type PaymentsFacadePort,
  type PayoutScheduleEntryView,
} from '../ports/payments-facade.port.js'

export interface ListPayoutScheduleQuery {
  readonly status?: string | undefined
  readonly pharmacyId?: string | undefined
  readonly limit: number
  readonly cursor: FinanceCursor | null
}

@Injectable()
export class ListPayoutScheduleUseCase {
  public constructor(@Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort) {}

  public async execute(query: ListPayoutScheduleQuery): Promise<FinancePage<PayoutScheduleEntryView>> {
    return this.paymentsFacade.findPayoutSchedule(
      { status: query.status, pharmacyId: query.pharmacyId },
      { limit: query.limit, cursor: query.cursor },
    )
  }
}
