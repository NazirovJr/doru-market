/**
 * `RevokeVerificationUseCase` (DTJ-072) — отзыв верификации (SRS-ADM-017):
 * признание, что предыдущее `approve` ошибочно. Каскадно приостанавливает
 * дочерние точки (если отзыв на уровне сети).
 *
 * Почему читаются оба источника: `pharmacy_verification.verification_status` —
 * «состояние проверки» (для проверки применимости `revoke`); `pharmacy_chains`/
 * `pharmacies.status` — «жизненный цикл онбординга» (для каскадного
 * `suspend('license_revoked')`).
 */
import { ConflictException, Inject, Injectable } from '@nestjs/common'
import {
  PHARMACY_ACCOUNT_REPOSITORY,
  type PharmacyAccountRepositoryPort,
} from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import type { PharmacyAccount } from '@/modules/onboarding/domain/pharmacy-account.entity.js'
import {
  PHARMACY_VERIFICATION_REPOSITORY,
  type PharmacyVerificationRepositoryPort,
  type PharmacyVerificationRow,
} from '@/modules/onboarding/application/ports/pharmacy-verification.repository.port.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewLogRepositoryPort,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'

export interface RevokeVerificationInput {
  readonly verificationId: string
  readonly actorId: string
  readonly reason: string
}

export interface RevokeVerificationResult {
  readonly verificationId: string
  readonly affectedPharmacyIds: readonly string[]
}

const REVOKABLE_STATUSES = new Set(['verified'])
const SUSPENDABLE_PHARMACY_STATUSES = new Set(['active', 'approved'])

@Injectable()
export class RevokeVerificationUseCase {
  constructor(
    @Inject(PHARMACY_VERIFICATION_REPOSITORY)
    private readonly pharmacyVerificationRepository: PharmacyVerificationRepositoryPort,
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(ONBOARDING_REVIEW_LOG_REPOSITORY)
    private readonly reviewLogRepository: OnboardingReviewLogRepositoryPort,
  ) {}

  async execute(input: RevokeVerificationInput): Promise<RevokeVerificationResult> {
    const verification = await this.loadOrThrow(input.verificationId)
    this.assertRevokable(verification)
    await this.markVerificationRevoked(verification, input)
    const affectedIds = await this.applyCascade(verification, input.actorId)
    await this.appendLog(verification, input, affectedIds)
    return { verificationId: input.verificationId, affectedPharmacyIds: affectedIds }
  }

  private async loadOrThrow(id: string): Promise<PharmacyVerificationRow> {
    const row = await this.pharmacyVerificationRepository.findById(id)
    if (row === null) {
      throw new ConflictException(`PharmacyVerification not found: ${id}`)
    }
    return row
  }

  private assertRevokable(row: PharmacyVerificationRow): void {
    if (!REVOKABLE_STATUSES.has(row.verificationStatus)) {
      throw new ConflictException(
        `Cannot revoke verification in status '${row.verificationStatus}' (must be 'verified')`,
      )
    }
  }

  private async markVerificationRevoked(row: PharmacyVerificationRow, input: RevokeVerificationInput): Promise<void> {
    await this.pharmacyVerificationRepository.save({
      ...row,
      verificationStatus: 'revoked',
      revokedAt: new Date(),
      revokedReason: input.reason,
      revokedBy: input.actorId,
    })
  }

  /** Каскадная приостановка дочерних точек (если отзыв на уровне сети) или самой точки. */
  private async applyCascade(row: PharmacyVerificationRow, actorId: string): Promise<readonly string[]> {
    if (row.chainId !== null) {
      const children = await this.pharmacyAccountRepository.listByChain(row.chainId)
      return this.suspendAll(children, actorId)
    }
    if (row.pharmacyId !== null) {
      const account = await this.pharmacyAccountRepository.findById(row.pharmacyId)
      if (account === null) {
        return []
      }
      return this.suspendAll([account], actorId)
    }
    return []
  }

  private async suspendAll(accounts: readonly PharmacyAccount[], actorId: string): Promise<readonly string[]> {
    const targetAccounts = accounts.filter((a) => SUSPENDABLE_PHARMACY_STATUSES.has(a.status))
    const suspended = targetAccounts.map((account) => {
      const next = account.suspend('license_revoked', { id: actorId })
      return this.pharmacyAccountRepository.save(next).then(() => account.id)
    })
    return Promise.all(suspended)
  }

  private async appendLog(
    row: PharmacyVerificationRow,
    input: RevokeVerificationInput,
    affectedIds: readonly string[],
  ): Promise<void> {
    await this.reviewLogRepository.append({
      ...(row.chainId !== null ? { chainId: row.chainId } : {}),
      ...(row.pharmacyId !== null ? { pharmacyId: row.pharmacyId } : {}),
      action: 'revoke',
      actorUserId: input.actorId,
      reason: input.reason,
      checklistSnapshot: { affectedPharmacyIds: affectedIds },
    })
  }
}
