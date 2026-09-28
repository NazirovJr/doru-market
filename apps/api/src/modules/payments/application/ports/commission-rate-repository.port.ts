// Порт CommissionRateRepository (DTJ-358) — CRUD над platform_fee (уже существующая таблица EP-10). Не проверяет пересечение периодов действия — не дублирует SRS-DOM-160.
export const COMMISSION_RATE_REPOSITORY = Symbol.for('@dorutj/payments/commission-rate-repository')

export interface CommissionRateRow {
  readonly id: string
  readonly tenantId: string | null
  readonly chainId: string | null
  readonly category: string | null
  readonly rateBps: number
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdBy: string
  readonly createdAt: Date | null
}

export interface CommissionRateCursor {
  readonly v: string
  readonly id: string
}

export interface FindCommissionRatesFilter {
  readonly tenantId?: string | undefined
  readonly chainId?: string | undefined
  readonly category?: string | undefined
}

export interface FindCommissionRatesInput extends FindCommissionRatesFilter {
  readonly limit: number
  readonly cursor: CommissionRateCursor | null
}

export interface FindCommissionRatesResult {
  readonly items: readonly CommissionRateRow[]
  readonly nextCursor: CommissionRateCursor | null
  readonly hasMore: boolean
}

export interface CommissionRateWriteFields {
  readonly tenantId: string | null
  readonly chainId: string | null
  readonly category: string
  readonly rateBps: number
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly createdBy: string
}

export interface UpdateCommissionRateInput extends CommissionRateWriteFields {
  readonly id: string
}

export interface ResolveActiveRateInput {
  readonly tenantId: string
  readonly chainId: string | null
  readonly category: string
  readonly now: Date
}

export interface CommissionRateRepository {
  findMany(input: FindCommissionRatesInput): Promise<FindCommissionRatesResult>

  insert(input: CommissionRateWriteFields): Promise<CommissionRateRow>

  /** `null` — строка `id` не найдена (use case маппит на `NotFoundError`). */
  update(input: UpdateCommissionRateInput): Promise<CommissionRateRow | null>

  /** Специфичность D-03/SRS-DOM-160: (tenant,chain,category) > (tenant,chain) > (tenant,category) > (tenant) > `null` (нет строки — вызывающий код применяет покатегорийный дефолт). */
  resolveActiveRate(input: ResolveActiveRateInput): Promise<number | null>
}
