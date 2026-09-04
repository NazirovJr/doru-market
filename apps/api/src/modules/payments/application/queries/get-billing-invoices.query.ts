/**
 * `GetBillingInvoicesQuery` (EP-10, DTJ-252, п.5) — `GET /api/v1/pharmacy-accounts/:id/
 * billing-invoices`, курсорная страница `platform_billing_invoices` СЕТИ, которой принадлежит
 * аптека `:id` (аптека → её `chain_id` — `PharmacyChainLookupPort`, единая точка резолва с
 * `GetPharmacyPayoutsQuery`).
 *
 * Ролевая политика — `assertChainReportAccess` (`pharmacy-report-access.util.ts`): `super_admin`/
 * `pharmacy_admin` (своя сеть) ТОЛЬКО — `pharmacist` НЕ допущен вовсе (в отличие от `.../payouts`,
 * см. ticket п.5 vs п.3 — инвойсы сети не read-only отдельной аптеке).
 *
 * `subtotalDiram`/`vatDiram`/`totalDiram` — `bigint → number` на границе DTO, тот же приём, что
 * `GetPharmacyPayoutsQuery`/`GetOrderLedgerQuery`.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  PLATFORM_BILLING_INVOICE_REPOSITORY,
  type BillingInvoiceCursor,
  type BillingInvoiceReportRow,
  type PlatformBillingInvoiceRepository,
} from '@/modules/payments/application/ports/platform-billing-invoice-repository.port.js'
import { PHARMACY_CHAIN_LOOKUP, type PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'
import { assertChainReportAccess, type PharmacyReportActor } from './pharmacy-report-access.util.js'

export interface GetBillingInvoicesInput {
  readonly pharmacyId: string
  readonly actor: Pick<PharmacyReportActor, 'role' | 'chainId'>
  readonly limit: number
  readonly cursor: BillingInvoiceCursor | null
}

export interface BillingInvoiceViewDto {
  readonly id: string
  readonly invoiceType: string
  readonly status: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly subtotalDiram: number
  readonly vatDiram: number
  readonly totalDiram: number
  readonly issuedAt: Date | null
  readonly dueAt: Date | null
  readonly paidAt: Date | null
}

export interface GetBillingInvoicesResult {
  readonly items: readonly BillingInvoiceViewDto[]
  readonly nextCursor: BillingInvoiceCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class GetBillingInvoicesQuery {
  public constructor(
    @Inject(PLATFORM_BILLING_INVOICE_REPOSITORY) private readonly invoiceRepository: PlatformBillingInvoiceRepository,
    @Inject(PHARMACY_CHAIN_LOOKUP) private readonly chainLookup: PharmacyChainLookupPort,
  ) {}

  public async execute(input: GetBillingInvoicesInput): Promise<GetBillingInvoicesResult> {
    await assertChainReportAccess(this.chainLookup, input.pharmacyId, input.actor)
    const chainId = await this.chainLookup.findChainId(input.pharmacyId)
    if (chainId === null) {
      // `super_admin` на несуществующую/сиротскую аптеку — пустой список (типичная REST-семантика
      // листинга под родителем, см. JSDoc `pharmacy-report-access.util.ts`), не ошибка.
      return { items: [], nextCursor: null, hasMore: false }
    }
    const page = await this.invoiceRepository.findByChain({ chainId, limit: input.limit, cursor: input.cursor })
    return { items: page.items.map(toBillingInvoiceViewDto), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }
}

function toBillingInvoiceViewDto(row: BillingInvoiceReportRow): BillingInvoiceViewDto {
  return {
    id: row.id,
    invoiceType: row.invoiceType,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    subtotalDiram: Number(row.subtotalDiram),
    vatDiram: Number(row.vatDiram),
    totalDiram: Number(row.totalDiram),
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
  }
}
