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

export interface OnboardingReviewPeriodRange {
  readonly start: Date
  readonly end: Date
}

export interface OnboardingReviewDurationStat {
  readonly decision: 'approved' | 'rejected'
  readonly averageDurationHours: number
  readonly count: number
}

export interface OnboardingReviewLogRepositoryPort {
  /** Append-only. Никаких `update`/`delete` — намеренно отсутствуют в API. */
  append(entry: ReviewLogEntry): Promise<void>
  /**
   * DTJ-384 (гостевое расширение из EP-17) — среднее время `pharmacy_chains.submitted_at → resolved_at`
   * последнего approve/reject заявки сети, за вычетом времени в `changes_requested` (SRS-ADM-008),
   * сгруппированное по решению. Читает, не мутирует — не противоречит append-only гарантии выше.
   */
  getReviewDurationStats(tenantId: string, period: OnboardingReviewPeriodRange): Promise<readonly OnboardingReviewDurationStat[]>
}
