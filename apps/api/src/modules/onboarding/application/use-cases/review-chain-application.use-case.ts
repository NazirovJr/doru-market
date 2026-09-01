/**
 * `ReviewChainApplicationUseCase` (DTJ-068) — 4 действия оператора над заявкой сети:
 * `approve`, `requestChanges`, `reject`, `terminate`. Один класс (C15/C17) —
 * общая инфраструктура: `pharmacyChainRepository` + `pharmacyVerificationRepository`
 * + `reviewLogRepository`.
 *
 * Каждое действие:
 * 1) переход через домен (`chain.approve(...)` и т.д.),
 * 2) апдейт `pharmacy_verification` (`verification_status`, `reviewed_by/at`),
 * 3) append-only запись в `onboarding_review_log`.
 *
 * `approve` дополнительно публикует `PharmacyChainActivatedEvent` (no-op outbox).
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'
import type { PharmacyChain } from '@/modules/onboarding/domain/pharmacy-chain.entity.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type PharmacyVerificationRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewLogRepositoryPort,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'
import type { PharmacyChainActivatedEvent } from '@/modules/onboarding/application/events/pharmacy-chain-activated.event.js'

export interface ReviewChainApproveInput {
  readonly chainId: string
  readonly actorId: string
  readonly checklist: Readonly<Record<string, boolean>>
  readonly notes: string | null
}

export interface ReviewChainChangeInput {
  readonly chainId: string
  readonly actorId: string
  readonly reason: string
}

export interface ReviewChainResult {
  readonly id: string
  readonly status: string
}

@Injectable()
export class ReviewChainApplicationUseCase {
  /** Буфер опубликованных событий (вне persistance — тестируемо без outbox). */
  private readonly publishedEvents: PharmacyChainActivatedEvent[] = []

  constructor(
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
    @Inject(PHARMACY_VERIFICATION_REPOSITORY)
    private readonly pharmacyVerificationRepository: PharmacyVerificationRepositoryPort,
    @Inject(ONBOARDING_REVIEW_LOG_REPOSITORY)
    private readonly reviewLogRepository: OnboardingReviewLogRepositoryPort,
  ) {}

  async approve(input: ReviewChainApproveInput): Promise<ReviewChainResult> {
    const chain = await this.loadOrThrow(input.chainId)
    const now = new Date()
    const approved = chain.approve({ id: input.actorId })
    await this.pharmacyChainRepository.save(approved)
    const existing = await this.pharmacyVerificationRepository.findBySubject({ chainId: input.chainId })
    if (existing !== null) {
      await this.pharmacyVerificationRepository.save({
        ...existing,
        verificationStatus: 'verified',
        reviewedBy: input.actorId,
        reviewedAt: now,
      })
    }
    await this.reviewLogRepository.append({
      chainId: input.chainId,
      action: 'approve',
      actorUserId: input.actorId,
      reason: input.notes,
      checklistSnapshot: input.checklist,
    })
    this.publishedEvents.push({
      type: 'PharmacyChainActivated',
      chainId: input.chainId,
      approvedBy: input.actorId,
      approvedAt: now,
    })
    return { id: approved.id, status: approved.status }
  }

  async requestChanges(input: ReviewChainChangeInput): Promise<ReviewChainResult> {
    const chain = await this.loadOrThrow(input.chainId)
    const changed = chain.requestChanges({ id: input.actorId }, input.reason)
    await this.pharmacyChainRepository.save(changed)
    await this.reviewLogRepository.append({
      chainId: input.chainId,
      action: 'changes_requested',
      actorUserId: input.actorId,
      reason: input.reason,
      checklistSnapshot: null,
    })
    return { id: changed.id, status: changed.status }
  }

  async reject(input: ReviewChainChangeInput): Promise<ReviewChainResult> {
    const chain = await this.loadOrThrow(input.chainId)
    const rejected = chain.reject({ id: input.actorId }, input.reason)
    await this.pharmacyChainRepository.save(rejected)
    await this.reviewLogRepository.append({
      chainId: input.chainId,
      action: 'reject',
      actorUserId: input.actorId,
      reason: input.reason,
      checklistSnapshot: null,
    })
    return { id: rejected.id, status: rejected.status }
  }

  async terminate(input: ReviewChainChangeInput): Promise<ReviewChainResult> {
    const chain = await this.loadOrThrow(input.chainId)
    const terminated = chain.terminate({ id: input.actorId }, input.reason)
    await this.pharmacyChainRepository.save(terminated)
    await this.reviewLogRepository.append({
      chainId: input.chainId,
      action: 'terminate',
      actorUserId: input.actorId,
      reason: input.reason,
      checklistSnapshot: null,
    })
    return { id: terminated.id, status: terminated.status }
  }

  private async loadOrThrow(chainId: string): Promise<PharmacyChain> {
    const chain = await this.pharmacyChainRepository.findById(chainId)
    if (chain === null) {
      throw new Error(`PharmacyChain not found: ${chainId}`)
    }
    return chain
  }
}
