/**
 * `SubmitChainForReviewUseCase` (DTJ-066) — переход `draft → pending_review` для
 * заявки сети. Создаёт (или обновляет, при повторной подаче после `rejected →
 * draft`) запись `pharmacy_verification` с `sla_target_at = submitted_at + 2
 * рабочих дня` (пятница→вторник, без учёта праздников РТ).
 */
import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type PharmacyVerificationRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'

export interface SubmitChainForReviewInput {
  readonly chainId: string
}

/** Чистая функция добавления N рабочих дней (пн-пт). */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date.getTime())
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const day = result.getDay()
    if (day !== WEEKEND_SUNDAY && day !== WEEKEND_SATURDAY) {
      added += 1
    }
  }
  return result
}

const WEEKEND_SUNDAY = 0
const WEEKEND_SATURDAY = 6

@Injectable()
export class SubmitChainForReviewUseCase {
  constructor(
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
    @Inject(PHARMACY_VERIFICATION_REPOSITORY)
    private readonly pharmacyVerificationRepository: PharmacyVerificationRepositoryPort,
  ) {}

  async execute(input: SubmitChainForReviewInput): Promise<{ id: string; status: string; slaTargetAt: Date }> {
    const chain = await this.pharmacyChainRepository.findById(input.chainId)
    if (chain === null) {
      throw new ConflictException(`PharmacyChain not found: ${input.chainId}`)
    }
    if (chain.status !== 'draft' && chain.status !== 'rejected') {
      throw new ConflictException(`Cannot submit chain in status ${chain.status}`)
    }
    const now = new Date()
    const submitted = chain.submitForReview(now)
    await this.pharmacyChainRepository.save(submitted)
    const slaTargetAt = addBusinessDays(now, 2)
    const existing = await this.pharmacyVerificationRepository.findBySubject({ chainId: input.chainId })
    if (existing === null) {
      await this.pharmacyVerificationRepository.save({
        chainId: input.chainId,
        verificationStatus: 'pending_review',
        submittedAt: now,
        slaTargetAt,
        reviewReason: 'initial',
      })
    } else {
      await this.pharmacyVerificationRepository.save({
        ...existing,
        verificationStatus: 'pending_review',
        submittedAt: now,
        slaTargetAt,
        reviewedBy: null,
        reviewedAt: null,
        reviewReason: 'initial',
      })
    }
    return { id: submitted.id, status: submitted.status, slaTargetAt }
  }
}
