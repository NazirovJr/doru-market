import { Inject, Injectable } from '@nestjs/common'
import {
  PAYMENTS_FACADE_PORT,
  type FinanceCursor,
  type FinancePage,
  type PaymentsFacadePort,
  type ReconciliationAlertView,
} from '../ports/payments-facade.port.js'

export interface ListReconciliationAlertsQuery {
  readonly limit: number
  readonly cursor: FinanceCursor | null
}

/** SRS-ADM-034 — только чтение результатов `EscrowReconciliationJob` (`apps/worker`, EP-10), ни одного мутирующего метода. */
@Injectable()
export class ListReconciliationAlertsUseCase {
  public constructor(@Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort) {}

  public async execute(query: ListReconciliationAlertsQuery): Promise<FinancePage<ReconciliationAlertView>> {
    return this.paymentsFacade.findReconciliationAlerts({ limit: query.limit, cursor: query.cursor })
  }
}
