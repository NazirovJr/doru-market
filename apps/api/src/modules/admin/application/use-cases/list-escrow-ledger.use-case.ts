import { Inject, Injectable } from '@nestjs/common'
import { ValidationError } from '@dorutj/contracts'
import { PAYMENTS_FACADE_PORT, type EscrowLedgerEntryView, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

export interface ListEscrowLedgerQuery {
  readonly orderId?: string | undefined
}

@Injectable()
export class ListEscrowLedgerUseCase {
  public constructor(@Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort) {}

  public async execute(query: ListEscrowLedgerQuery): Promise<readonly EscrowLedgerEntryView[]> {
    if (query.orderId === undefined || query.orderId.trim() === '') {
      throw new ValidationError('ListEscrowLedgerUseCase requires filter[orderId]')
    }
    return this.paymentsFacade.findEscrowLedgerEntries(query.orderId)
  }
}
