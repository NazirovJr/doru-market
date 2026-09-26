import { Inject, Injectable } from '@nestjs/common'
import { parsePeriod } from './get-funnel.use-case.js'
import {
  ANALYTICS_ONBOARDING_FACADE_PORT,
  type OnboardingFacadePort,
  type OnboardingReviewDurationStat,
} from '../ports/onboarding-facade.port.js'

export interface GetOnboardingFunnelInput {
  readonly tenantId: string
  readonly period: string
}

export type GetOnboardingFunnelResult = readonly OnboardingReviewDurationStat[]

@Injectable()
export class GetOnboardingFunnelUseCase {
  public constructor(
    @Inject(ANALYTICS_ONBOARDING_FACADE_PORT) private readonly onboardingFacade: OnboardingFacadePort,
  ) {}

  public async execute(input: GetOnboardingFunnelInput): Promise<GetOnboardingFunnelResult> {
    const range = parsePeriod(input.period)
    return this.onboardingFacade.getReviewDurationStats(input.tenantId, range)
  }
}
