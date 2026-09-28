// Фильтр type не хардкодится на cash_courier_commission здесь — это UI-дефолт, backend остаётся общим листингом.
import { Inject, Injectable } from '@nestjs/common'
import { ONBOARDING_FACADE_PORT, type OnboardingFacadePort } from '../ports/onboarding-facade.port.js'
import { PAYMENTS_FACADE_PORT, type BillingInvoiceView, type FinanceCursor, type FinancePage, type PaymentsFacadePort } from '../ports/payments-facade.port.js'

export interface ListBillingInvoicesQuery {
  readonly chainId?: string | undefined
  readonly invoiceType?: string | undefined
  readonly status?: string | undefined
  readonly limit: number
  readonly cursor: FinanceCursor | null
}

export interface BillingInvoiceListItem extends BillingInvoiceView {
  readonly chainName: string | null
}

@Injectable()
export class ListBillingInvoicesUseCase {
  public constructor(
    @Inject(PAYMENTS_FACADE_PORT) private readonly paymentsFacade: PaymentsFacadePort,
    @Inject(ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
  ) {}

  public async execute(query: ListBillingInvoicesQuery): Promise<FinancePage<BillingInvoiceListItem>> {
    const page = await this.paymentsFacade.listBillingInvoices(
      { chainId: query.chainId, invoiceType: query.invoiceType, status: query.status },
      { limit: query.limit, cursor: query.cursor },
    )
    const chainNames = await this.onboardingFacade.findChainNames([...new Set(page.items.map((item) => item.chainId))])
    return {
      items: page.items.map((item) => ({ ...item, chainName: chainNames.get(item.chainId) ?? null })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    }
  }
}
