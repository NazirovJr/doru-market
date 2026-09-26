import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

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

// ДОБАВЛЕНО (DTJ-317) — DeliverUseCase создаёт строку ТОЛЬКО для chainId IS NULL (REQ-COUR-3).
export interface CreateCourierEarningInput {
  readonly id: string
  readonly courierId: string
  readonly deliveryAssignmentId: string
  readonly amountDiram: bigint
  // Натуральный ключ идемпотентности — 1 строка earnings на 1 доставленное назначение (assignmentId уникален).
  readonly idempotencyKey: string
}

export interface CourierEarningsRepositoryPort {
  findPage(input: FindCourierEarningsInput): Promise<FindCourierEarningsResult>
  create(input: CreateCourierEarningInput, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
