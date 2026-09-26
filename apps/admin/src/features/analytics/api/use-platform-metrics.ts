import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { PlatformMetricsResponseDto } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

const PLATFORM_METRICS_PATH = '/api/v1/analytics/platform-metrics'

export type PlatformMetricsData = PlatformMetricsResponseDto

export async function fetchPlatformMetrics(tenantId: string, period: string): Promise<PlatformMetricsData> {
  return httpGetJson<PlatformMetricsData>(PLATFORM_METRICS_PATH, { tenantId, period })
}

export function platformMetricsQueryKey(tenantId: string, period: string): readonly unknown[] {
  return ['admin', 'analytics', 'platform-metrics', tenantId, period] as const
}

export function usePlatformMetrics(tenantId: string | null, period: string): UseQueryResult<PlatformMetricsData, HttpError> {
  return useQuery<PlatformMetricsData, HttpError>({
    queryKey: platformMetricsQueryKey(tenantId ?? '', period),
    queryFn: () => fetchPlatformMetrics(tenantId ?? '', period),
    enabled: tenantId !== null,
  })
}

export type { HttpError }
