import type { AnalyticsPeriodRange } from './product-events-repository.port.js'

// Узкий порт analytics → onboarding (DTJ-384), по аналогии с inventory-facade.port.ts; отдельный от modules/admin.
export const ANALYTICS_ONBOARDING_FACADE_PORT = Symbol.for('@dorutj/analytics/onboarding-facade-port')

export interface OnboardingReviewDurationStat {
  readonly decision: 'approved' | 'rejected'
  readonly averageDurationHours: number
  readonly count: number
}

export interface OnboardingFacadePort {
  getReviewDurationStats(tenantId: string, period: AnalyticsPeriodRange): Promise<readonly OnboardingReviewDurationStat[]>
}
