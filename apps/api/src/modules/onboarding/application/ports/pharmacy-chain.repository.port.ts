/**
 * `PharmacyChainRepositoryPort` (DTJ-064) — application-уровень контракта доступа
 * к агрегату `PharmacyChain`.
 *
 * `findByTinInn` — уникальный резолв заявки по ИНН (REQ-ONBOARD-19, SRS-ADM-007 —
 * повторная подача переиспользует запись). `findById`/`save` — базовые CRUD
 * операции. Реализация в `infrastructure/repositories/pharmacy-chain.repository.ts`.
 */
import type { PharmacyChain } from '../../domain/pharmacy-chain.entity.js'

export const PHARMACY_CHAIN_REPOSITORY = Symbol.for('@dorutj/onboarding/pharmacy-chain-repository')

export interface ListByStatusFilter {
  readonly status?: string
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
  }[]
  readonly total: number
}

export interface PharmacyChainRepositoryPort {
  findById(id: string): Promise<PharmacyChain | null>
  findByTinInn(tinInn: string): Promise<PharmacyChain | null>
  listByStatus(filter: ListByStatusFilter): Promise<ListByStatusResult>
  save(chain: PharmacyChain): Promise<void>
}
