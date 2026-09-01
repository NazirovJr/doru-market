/**
 * `ReviewPharmacyApplicationUseCase` (DTJ-068) — зеркало
 * `ReviewChainApplicationUseCase` для `PharmacyAccount`. Дополнительно
 * публикует `PharmacyAccountActivatedEvent`.
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type PharmacyVerificationRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewLogRepositoryPort,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'
import type { PharmacyAccountActivatedEvent } from '@/modules/onboarding/application/events/pharmacy-account-activated.event.js'

export interface ReviewPharmacyApproveInput {
  readonly pharmacyId: string
  readonly actorId: string
  readonly checklist: Readonly<Record<string, boolean>>
  readonly notes: string | null
}

export interface ReviewPharmacyChangeInput {
  readonly pharmacyId: string
  readonly actorId: string
  readonly reason: string
}

export interface ReviewPharmacyResult {
  readonly id: string
  readonly status: string
}

@Injectable()
export class ReviewPharmacyApplicationUseCase {
  private readonly publishedEvents: PharmacyAccountActivatedEvent[] = []

  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(PHARMACY_VERIFICATION_REPOSITORY)
    private readonly pharmacyVerificationRepository: PharmacyVerificationRepositoryPort,
    @Inject(ONBOARDING_REVIEW_LOG_REPOSITORY)
    private readonly reviewLogRepository: OnboardingReviewLogRepositoryPort,
  ) {}

  async approve(input: ReviewPharmacyApproveInput): Promise<ReviewPharmacyResult> {
    const account = await this.loadOrThrow(input.pharmacyId)
    const now = new Date()
    const approved = account.approve({ id: input.actorId })
    await this.pharmacyAccountRepository.save(approved)
    const existing = await this.pharmacyVerificationRepository.findBySubject({ pharmacyId: input.pharmacyId })
    if (existing !== null) {
      await this.pharmacyVerificationRepository.save({
        ...existing,
        verificationStatus: 'verified',
        reviewedBy: input.actorId,
        reviewedAt: now,
      })
    }
    await this.reviewLogRepository.append({
      pharmacyId: input.pharmacyId,
      action: 'approve',
      actorUserId: input.actorId,
      reason: input.notes,
      checklistSnapshot: input.checklist,
    })
    this.publishedEvents.push({
      type: 'PharmacyAccountActivated',
      pharmacyId: input.pharmacyId,
      chainId: approved.chainId,
      approvedBy: input.actorId,
      approvedAt: now,
    })
    return { id: approved.id, status: approved.status }
  }

  async requestChanges(input: ReviewPharmacyChangeInput): Promise<ReviewPharmacyResult> {
    const account = await this.loadOrThrow(input.pharmacyId)
    const changed = account.requestChanges({ id: input.actorId }, input.reason)
    await this.pharmacyAccountRepository.save(changed)
    await this.reviewLogRepository.append({
      pharmacyId: input.pharmacyId,
      action: 'changes_requested',
      actorUserId: input.actorId,
      reason: input.reason,
      checklistSnapshot: null,
    })
    return { id: changed.id, status: changed.status }
  }

  async reject(input: ReviewPharmacyChangeInput): Promise<ReviewPharmacyResult> {
    const account = await this.loadOrThrow(input.pharmacyId)
    const rejected = account.reject({ id: input.actorId }, input.reason)
    await this.pharmacyAccountRepository.save(rejected)
    await this.reviewLogRepository.append({
      pharmacyId: input.pharmacyId,
      action: 'reject',
      actorUserId: input.actorId,
      reason: input.reason,
      checklistSnapshot: null,
    })
    return { id: rejected.id, status: rejected.status }
  }

  async terminate(input: ReviewPharmacyChangeInput): Promise<ReviewPharmacyResult> {
    const account = await this.loadOrThrow(input.pharmacyId)
    const terminated = account.terminate({ id: input.actorId }, input.reason)
    await this.pharmacyAccountRepository.save(terminated)
    await this.reviewLogRepository.append({
      pharmacyId: input.pharmacyId,
      action: 'terminate',
      actorUserId: input.actorId,
      reason: input.reason,
      checklistSnapshot: null,
    })
    return { id: terminated.id, status: terminated.status }
  }

  private async loadOrThrow(pharmacyId: string): Promise<PharmacyAccount> {
    const account = await this.pharmacyAccountRepository.findById(pharmacyId)
    if (account === null) {
      throw new Error(`PharmacyAccount not found: ${pharmacyId}`)
    }
    return account
  }
}
