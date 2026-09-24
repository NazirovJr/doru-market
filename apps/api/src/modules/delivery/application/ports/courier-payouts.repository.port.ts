/**
 * `CourierPayoutsRepositoryPort` (EP-13, DTJ-321, SRS-DELIV-031) — курсорная (keyset) страница
 * `courier_payouts`. `courierId: null` — `super_admin` БЕЗ `filter[courierId]` (текст тикета:
 * «courier видит только свои, super_admin — все/по фильтру» — В ОТЛИЧИЕ от `courier-earnings`,
 * где фильтр для `super_admin` ОБЯЗАТЕЛЕН, здесь он опционален, `GetCourierPayoutsQuery` резолвит
 * разницу). Сортировка `created_at DESC, id DESC`.
 */
export const COURIER_PAYOUTS_REPOSITORY = Symbol.for('@dorutj/delivery/courier-payouts-repository')

/** Декодированный курсор — `v` ISO-строка `created_at`, `id` — `courier_payouts.id` (tie-break). */
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
  /** `null` = все курьеры (только `super_admin` БЕЗ `filter[courierId]`, см. JSDoc файла). */
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
