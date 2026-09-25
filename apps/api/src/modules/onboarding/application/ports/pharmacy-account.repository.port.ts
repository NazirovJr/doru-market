/**
 * `PharmacyAccountRepositoryPort` (DTJ-065) — application-уровень контракта доступа
 * к агрегату `PharmacyAccount`. `findById`/`save` — базовые CRUD.
 */
import type { PharmacyAccount } from '../../domain/pharmacy-account.entity.js'

export const PHARMACY_ACCOUNT_REPOSITORY = Symbol.for('@dorutj/onboarding/pharmacy-account-repository')

export interface ListByStatusFilter {
  readonly status?: string
  readonly licenseExpiryBefore?: Date
  readonly limit: number
  readonly offset: number
}

export interface ListByStatusResult {
  readonly items: readonly {
    readonly id: string
    readonly status: string
    readonly submittedAt: Date | null
    readonly reviewReason: string | null
    readonly slaTargetAt: Date | null
    readonly licenseNumber: string | null
    readonly licenseExpiryDate: Date | null
  }[]
  readonly total: number
}

export interface PharmacyAccountRepositoryPort {
  findById(id: string): Promise<PharmacyAccount | null>
  listByStatus(filter: ListByStatusFilter): Promise<ListByStatusResult>
  listByChain(chainId: string): Promise<readonly PharmacyAccount[]>
  save(account: PharmacyAccount): Promise<void>
  // Аптеки status='active' сети tenantId, чья сеть в approved|active — тот же критерий, что isPharmacyActive, батчем.
  listActiveIdsByTenant(tenantId: string): Promise<readonly string[]>
  listAny(query: ListAnyQuery): Promise<ListAnyPage>
}

// listAny (DTJ-353) — ЛЮБОЙ статус (в отличие от listByStatus, ограниченного EP-03 pending_review).
export interface ListAnyFilter {
  readonly status?: string
  readonly chainId?: string
  readonly nameLike?: string
}

export interface ListAnyCursor {
  readonly v: string
  readonly id: string
}

export interface ListAnyQuery {
  readonly filter: ListAnyFilter
  readonly limit: number
  readonly cursor?: ListAnyCursor | null
}

export interface ListAnyItem {
  readonly id: string
  readonly chainId: string | null
  readonly name: string
  readonly status: string
  readonly licenseExpiryDate: Date | null
}

export interface ListAnyPage {
  readonly items: readonly ListAnyItem[]
  readonly nextCursor: ListAnyCursor | null
  readonly hasMore: boolean
}
