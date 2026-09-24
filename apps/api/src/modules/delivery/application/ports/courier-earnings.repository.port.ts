export const COURIER_EARNINGS_REPOSITORY = Symbol.for('@dorutj/delivery/courier-earnings-repository')

export interface CourierEarningsCursor {
  readonly v: string
  readonly id: string
}

export interface CourierEarningRow {
  readonly id: string
  readonly amountDiram: bigint
  readonly isReturnFee: boolean
  readonly recognizedAt: Date
  readonly payoutBatchId: string | null
}

export interface FindCourierEarningsInput {
  readonly courierId: string
  readonly limit: number
  readonly cursor: CourierEarningsCursor | null
}

export interface FindCourierEarningsResult {
  readonly items: readonly CourierEarningRow[]
  readonly nextCursor: CourierEarningsCursor | null
  readonly hasMore: boolean
}

export interface CourierEarningsRepositoryPort {
  findPage(input: FindCourierEarningsInput): Promise<FindCourierEarningsResult>
}
