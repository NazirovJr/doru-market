// Адаптер DTJ-384: межмодульно только через фасад (modules/onboarding/index.ts), не напрямую в onboarding/**.
import { Inject, Injectable } from '@nestjs/common'
import { OnboardingFacade } from '@/modules/onboarding/index.js'
import type { AnalyticsPeriodRange } from '@/modules/analytics/application/ports/product-events-repository.port.js'
import {
  ANALYTICS_ONBOARDING_FACADE_PORT,
  type OnboardingFacadePort,
  type OnboardingReviewDurationStat,
} from '@/modules/analytics/application/ports/onboarding-facade.port.js'

@Injectable()
export class OnboardingFacadeAdapter implements OnboardingFacadePort {
  constructor(@Inject(OnboardingFacade) private readonly onboarding: OnboardingFacade) {}

  async getReviewDurationStats(tenantId: string, period: AnalyticsPeriodRange): Promise<readonly OnboardingReviewDurationStat[]> {
    return this.onboarding.getReviewDurationStats(tenantId, period)
  }
}

export const ONBOARDING_FACADE_PORT_PROVIDER = { provide: ANALYTICS_ONBOARDING_FACADE_PORT, useClass: OnboardingFacadeAdapter }
