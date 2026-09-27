// ListCommissionRatesUseCase (DTJ-358) — тонкая делегация PAYMENTS_FACADE_PORT, тот же приём, что ListPayoutScheduleUseCase.
import { Inject, Injectable } from '@nestjs/common'
import {
  PAYMENTS_FACADE_PORT,
  type CommissionRateView,
  type FinanceCursor,
  type FinancePage,
  type PaymentsFacadePort,
} from '../ports/payments-facade.port.js'

export interface ListCommissionRatesQuery {
  readonly tenantId?: string | undefined
  readonly chainId?: string | undefined
  readonly category?: string | undefined
  readonly limit: number
  readonly cursor: FinanceCursor | null
}

@Injectable()
export class ListCommissionRatesUseCase {
  public constructor(@Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort) {}

  public async execute(query: ListCommissionRatesQuery): Promise<FinancePage<CommissionRateView>> {
    return this.paymentsFacade.listCommissionRates(
      { tenantId: query.tenantId, chainId: query.chainId, category: query.category },
      { limit: query.limit, cursor: query.cursor },
    )
  }
}
