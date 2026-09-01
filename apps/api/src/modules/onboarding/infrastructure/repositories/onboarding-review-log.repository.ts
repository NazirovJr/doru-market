/**
 * Drizzle-реализация `OnboardingReviewLogRepositoryPort` (DTJ-068). INSERT-only.
 * `update`/`delete` НЕ реализованы — соответствует контракту порта.
 */
import { Inject, Injectable } from '@nestjs/common'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { onboardingReviewLog } from '@/db/schema/onboarding-review-log.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewLogRepositoryPort,
  type ReviewLogEntry,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'

export { ONBOARDING_REVIEW_LOG_REPOSITORY }

@Injectable()
export class DrizzleOnboardingReviewLogRepository implements OnboardingReviewLogRepositoryPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async append(entry: ReviewLogEntry): Promise<void> {
    await this.db.insert(onboardingReviewLog).values({
      chainId: entry.chainId ?? null,
      pharmacyId: entry.pharmacyId ?? null,
      action: entry.action,
      actorUserId: entry.actorUserId,
      reason: entry.reason,
      checklistSnapshot: entry.checklistSnapshot,
    })
  }
}
