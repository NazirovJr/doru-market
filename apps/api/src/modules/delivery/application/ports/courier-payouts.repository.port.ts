export const COURIER_PAYOUTS_REPOSITORY = Symbol.for('@dorutj/delivery/courier-payouts-repository')

export interface CourierPayoutsCursor {
  readonly v: string
  readonly id: string
}

export interface CourierPayoutRow {
  readonly id: string
  readonly courierId: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly totalAmountDiram: bigint
  readonly cashRemittanceOffsetDiram: bigint
  readonly status: 'draft' | 'issued' | 'paid' | 'failed'
  readonly issuedAt: Date | null
  readonly paidAt: Date | null
}

export interface FindCourierPayoutsInput {
  readonly courierId: string | null
  readonly limit: number
  readonly cursor: CourierPayoutsCursor | null
}

export interface FindCourierPayoutsResult {
  readonly items: readonly CourierPayoutRow[]
  readonly nextCursor: CourierPayoutsCursor | null
  readonly hasMore: boolean
}

export interface CourierPayoutsRepositoryPort {
  findPage(input: FindCourierPayoutsInput): Promise<FindCourierPayoutsResult>
}
