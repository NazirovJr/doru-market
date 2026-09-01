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
}
