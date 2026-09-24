/**
 * `CourierEarningsRepositoryPort` (EP-13, DTJ-321, SRS-DELIV-030) — курсорная (keyset) страница
 * `courier_earnings` ОДНОГО курьера. 1:1 приём `payments/application/ports/
 * payout-schedule-repository.port.ts` (`findByPharmacy`, DTJ-252): `courierId` — ВСЕГДА разрешён
 * ДО вызова порта (свой — из JWT, `super_admin` — из ОБЯЗАТЕЛЬНОГО `filter[courierId]`, проверено
 * `GetCourierEarningsQuery`) — порт не поддерживает «все курьеры сразу» намеренно (текст тикета:
 * `filter[courierId]` обязателен для `super_admin`, а не опционален).
 *
 * Сортировка `recognized_at DESC, id DESC` (свежие сначала, tie-break по `id`) — тот же паттерн,
 * что `PayoutCursor`.
 */
export const COURIER_EARNINGS_REPOSITORY = Symbol.for('@dorutj/delivery/courier-earnings-repository')

/** Декодированный курсор — `v` ISO-строка `recognized_at`, `id` — `courier_earnings.id` (tie-break). */
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
