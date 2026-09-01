/**
 * `OnboardingReviewLogRepositoryPort` (DTJ-068) — append-only журнал решений
 * `super_admin`. ВАЖНО: интерфейс НЕ СОДЕРЖИТ методов `update`/`delete` — это
 * архитектурная гарантия неизменности (соответствует REVOKE на уровне БД).
 */
export const ONBOARDING_REVIEW_LOG_REPOSITORY = Symbol.for('@dorutj/onboarding/onboarding-review-log-repository')

export type ReviewAction = 'approve' | 'changes_requested' | 'reject' | 'terminate' | 'suspend' | 'reactivate' | 'revoke'

export interface ReviewLogEntry {
  readonly id?: string
  readonly chainId?: string
  readonly pharmacyId?: string
  readonly action: ReviewAction
  readonly actorUserId: string
  readonly reason: string | null
  readonly checklistSnapshot: unknown
  readonly createdAt?: Date
}

export interface OnboardingReviewLogRepositoryPort {
  /** Append-only. Никаких `update`/`delete` — намеренно отсутствуют в API. */
  append(entry: ReviewLogEntry): Promise<void>
}
