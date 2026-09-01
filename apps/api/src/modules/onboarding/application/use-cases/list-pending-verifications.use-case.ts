/**
 * `ListPendingVerificationsUseCase` (DTJ-067) — FIFO-очередь заявок для модератора.
 * Поддерживает фильтр по типу субъекта и статусу; сортировка по `submittedAt asc`.
 * Cursor-пагинация — упрощённый offset (для модератора объём очереди <500 записей
 * одновременно, согласовано в DTJ-067 «Объём и стратегия»).
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'

export type ListSubjectType = 'chain' | 'pharmacy'

export interface ListVerificationsInput {
  readonly subjectType: ListSubjectType
  readonly status?: string
  readonly limit?: number
  readonly offset?: number
}

export interface ListVerificationsItem {
  readonly id: string
  readonly status: string
  readonly submittedAt: Date | null
  readonly reviewReason: string | null
  readonly slaTargetAt: Date | null
}

export interface ListVerificationsResult {
  readonly items: readonly ListVerificationsItem[]
  readonly total: number
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const DEFAULT_OFFSET = 0

@Injectable()
export class ListPendingVerificationsUseCase {
  constructor(
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
  ) {}

  async execute(input: ListVerificationsInput): Promise<ListVerificationsResult> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = Math.max(input.offset ?? DEFAULT_OFFSET, 0)
    const status = input.status
    if (input.subjectType === 'chain') {
      const { items, total } = await this.pharmacyChainRepository.listByStatus(
        status === undefined ? { limit, offset } : { status, limit, offset },
      )
      return { items: items.map(toItem), total }
    }
    const { items, total } = await this.pharmacyAccountRepository.listByStatus(
      status === undefined ? { limit, offset } : { status, limit, offset },
    )
    return { items: items.map(toItem), total }
  }
}

function toItem(row: {
  readonly id: string
  readonly status: string
  readonly submittedAt: Date | null
  readonly reviewReason: string | null
  readonly slaTargetAt: Date | null
}): ListVerificationsItem {
  return {
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt,
    reviewReason: row.reviewReason,
    slaTargetAt: row.slaTargetAt,
  }
}
