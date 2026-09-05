/**
 * `GetPharmacyPayoutsQuery` (EP-10, DTJ-252, АС3/АС5) — `GET /api/v1/pharmacy-accounts/:id/payouts`,
 * курсорная страница `payout_schedule` ОДНОЙ аптеки. Query-объект (read-only), тот же паттерн
 * «один класс, один публичный `execute()`», что `GetOrderLedgerQuery` (DTJ-248).
 *
 * Ролевая политика — `pharmacy-report-access.util.ts` (см. её JSDoc, единая точка для ТРЁХ
 * query'ей этого тикета).
 *
 * `grossAmountDiram`/`commissionDiram`/`netAmountDiram` — `bigint → number` на границе DTO,
 * тот же приём, что `LedgerEntryViewDto.amountDiram` (`get-order-ledger.query.ts`) — суммы TJS
 * далеко в пределах `Number.MAX_SAFE_INTEGER` в дирамах.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  PAYOUT_SCHEDULE_REPOSITORY,
  type PayoutCursor,
  type PayoutReportRow,
  type PayoutScheduleRepository,
} from '@/modules/payments/application/ports/payout-schedule-repository.port.js'
import { PHARMACY_CHAIN_LOOKUP, type PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'
import { assertPharmacyReportAccess, type PharmacyReportActor } from './pharmacy-report-access.util.js'

export interface GetPharmacyPayoutsInput {
  readonly pharmacyId: string
  readonly actor: PharmacyReportActor
  readonly statuses?: readonly string[] | undefined
  readonly limit: number
  readonly cursor: PayoutCursor | null
}

export interface PayoutViewDto {
  readonly orderId: string
  readonly orderNumber: string
  readonly grossAmountDiram: number
  readonly commissionDiram: number
  readonly netAmountDiram: number
  readonly status: string
  readonly dueAt: Date | null
  readonly paidAt: Date | null
}

export interface GetPharmacyPayoutsResult {
  readonly items: readonly PayoutViewDto[]
  readonly nextCursor: PayoutCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class GetPharmacyPayoutsQuery {
  public constructor(
    @Inject(PAYOUT_SCHEDULE_REPOSITORY) private readonly payoutRepository: PayoutScheduleRepository,
    @Inject(PHARMACY_CHAIN_LOOKUP) private readonly chainLookup: PharmacyChainLookupPort,
  ) {}

  public async execute(input: GetPharmacyPayoutsInput): Promise<GetPharmacyPayoutsResult> {
    await assertPharmacyReportAccess(this.chainLookup, input.pharmacyId, input.actor)
    const page = await this.payoutRepository.findByPharmacy({
      pharmacyId: input.pharmacyId,
      statuses: input.statuses,
      limit: input.limit,
      cursor: input.cursor,
    })
    return { items: page.items.map(toPayoutViewDto), nextCursor: page.nextCursor, hasMore: page.hasMore }
  }
}

function toPayoutViewDto(row: PayoutReportRow): PayoutViewDto {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    grossAmountDiram: Number(row.grossAmountDiram),
    commissionDiram: Number(row.commissionDiram),
    netAmountDiram: Number(row.netAmountDiram),
    status: row.status,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
  }
}
