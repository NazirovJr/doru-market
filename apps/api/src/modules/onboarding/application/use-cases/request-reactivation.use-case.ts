/**
 * `RequestReactivationUseCase` (DTJ-074) — единственный легитимный путь
 * `suspended → pending_review`. Домен защищён `AutomaticReactivationForbiddenError`
 * от прямого `activate()` (DTJ-063), этот use case реализует ЕДИНСТВЕННЫЙ
 * разрешённый путь.
 */
import { ConflictException, Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type PharmacyVerificationRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import { addBusinessDays } from './submit-chain-for-review.use-case.js'

export interface RequestReactivationInput {
  readonly pharmacyId: string
  readonly actorId: string
}

export interface RequestReactivationResult {
  readonly pharmacyId: string
  readonly status: string
  readonly slaTargetAt: Date
}

@Injectable()
export class RequestReactivationUseCase {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(PHARMACY_VERIFICATION_REPOSITORY)
    private readonly pharmacyVerificationRepository: PharmacyVerificationRepositoryPort,
  ) {}

  async execute(input: RequestReactivationInput): Promise<RequestReactivationResult> {
    const account = await this.pharmacyAccountRepository.findById(input.pharmacyId)
    if (account === null) {
      throw new ConflictException(`PharmacyAccount not found: ${input.pharmacyId}`)
    }
    if (account.status !== 'suspended') {
      throw new ConflictException(`RequestReactivation requires status='suspended', got '${account.status}'`)
    }
    const now = new Date()
    const reactivated = account.requestReactivation()
    await this.pharmacyAccountRepository.save(reactivated)
    const slaTargetAt = addBusinessDays(now, 2)
    await this.pharmacyVerificationRepository.save({
      pharmacyId: input.pharmacyId,
      verificationStatus: 'pending_review',
      submittedAt: now,
      slaTargetAt,
      reviewReason: 'reactivation',
    })
    return { pharmacyId: input.pharmacyId, status: reactivated.status, slaTargetAt }
  }
}
