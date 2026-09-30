/**
 * `ListPendingVerificationsUseCase` (DTJ-067) — FIFO-очередь заявок для модератора.
 * Фильтр по типу субъекта и статусу; старые заявки первыми, keyset-курсор (новая
 * заявка не теряется за границей страницы).
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { QueueCursor, QueueItem } from '@/modules/onboarding/application/ports/verification-queue.types.js'

export type ListSubjectType = 'chain' | 'pharmacy'

export interface ListVerificationsInput {
  readonly subjectType: ListSubjectType
  readonly status?: string
  readonly limit: number
  readonly cursor: QueueCursor | null
}

export interface ListVerificationsResult {
  readonly items: readonly QueueItem[]
  readonly nextCursor: QueueCursor | null
  readonly hasMore: boolean
}

@Injectable()
export class ListPendingVerificationsUseCase {
  constructor(
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
  ) {}

  execute(input: ListVerificationsInput): Promise<ListVerificationsResult> {
    const query = {
      ...(input.status === undefined ? {} : { status: input.status }),
      limit: input.limit,
      cursor: input.cursor,
    }
    return input.subjectType === 'chain'
      ? this.pharmacyChainRepository.listQueue(query)
      : this.pharmacyAccountRepository.listQueue(query)
  }
}
