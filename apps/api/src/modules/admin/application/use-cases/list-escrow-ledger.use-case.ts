import { Inject, Injectable } from '@nestjs/common'
import {
  PAYMENTS_FACADE_PORT,
  type EscrowLedgerEntryView,
  type FinanceCursor,
  type FinancePage,
  type PaymentsFacadePort,
} from '../ports/payments-facade.port.js'

export interface ListEscrowLedgerQuery {
  readonly orderId?: string | undefined
  readonly limit: number
  readonly cursor: FinanceCursor | null
}

@Injectable()
export class ListEscrowLedgerUseCase {
  public constructor(@Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort) {}

  public async execute(query: ListEscrowLedgerQuery): Promise<FinancePage<EscrowLedgerEntryView>> {
    return this.paymentsFacade.findEscrowLedgerEntries({ orderId: query.orderId }, { limit: query.limit, cursor: query.cursor })
  }
}
