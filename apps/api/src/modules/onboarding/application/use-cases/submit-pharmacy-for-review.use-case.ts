/**
 * `SubmitPharmacyForReviewUseCase` (DTJ-066) — переход `draft → pending_review`
 * для заявки аптечной точки. Зеркало `SubmitChainForReviewUseCase`.
 */
import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type PharmacyVerificationRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import { addBusinessDays } from './submit-chain-for-review.use-case.js'

export interface SubmitPharmacyForReviewInput {
  readonly pharmacyId: string
}

@Injectable()
export class SubmitPharmacyForReviewUseCase {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(PHARMACY_VERIFICATION_REPOSITORY)
    private readonly pharmacyVerificationRepository: PharmacyVerificationRepositoryPort,
  ) {}

  async execute(input: SubmitPharmacyForReviewInput): Promise<{ id: string; status: string; slaTargetAt: Date }> {
    const account = await this.pharmacyAccountRepository.findById(input.pharmacyId)
    if (account === null) {
      throw new ConflictException(`PharmacyAccount not found: ${input.pharmacyId}`)
    }
    if (account.status !== 'draft' && account.status !== 'rejected') {
      throw new ConflictException(`Cannot submit pharmacy in status ${account.status}`)
    }
    const now = new Date()
    const submitted = account.submitForReview(now)
    await this.pharmacyAccountRepository.save(submitted)
    const slaTargetAt = addBusinessDays(now, 2)
    const existing = await this.pharmacyVerificationRepository.findBySubject({ pharmacyId: input.pharmacyId })
    if (existing === null) {
      await this.pharmacyVerificationRepository.save({
        pharmacyId: input.pharmacyId,
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
