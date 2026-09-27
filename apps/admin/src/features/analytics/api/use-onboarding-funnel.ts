// GET /api/v1/analytics/onboarding-funnel (DTJ-384) — та же форма запроса/ответа, что use-funnel.ts.
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { OnboardingFunnelResponseDto } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

const ONBOARDING_FUNNEL_PATH = '/api/v1/analytics/onboarding-funnel'

export type OnboardingFunnelData = OnboardingFunnelResponseDto

export async function fetchOnboardingFunnel(tenantId: string, period: string): Promise<OnboardingFunnelData> {
  return httpGetJson<OnboardingFunnelData>(ONBOARDING_FUNNEL_PATH, { tenantId, period })
}

export function onboardingFunnelQueryKey(tenantId: string, period: string): readonly unknown[] {
  return ['admin', 'analytics', 'onboarding-funnel', tenantId, period] as const
}

export function useOnboardingFunnel(tenantId: string | null, period: string): UseQueryResult<OnboardingFunnelData, HttpError> {
  return useQuery<OnboardingFunnelData, HttpError>({
    queryKey: onboardingFunnelQueryKey(tenantId ?? '', period),
    queryFn: () => fetchOnboardingFunnel(tenantId ?? '', period),
    enabled: tenantId !== null,
  })
}

export type { HttpError }
