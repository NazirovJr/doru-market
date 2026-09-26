// GET /api/v1/analytics/top-analogs (DTJ-383) — та же форма запроса/ответа через @dorutj/contracts, что use-funnel.ts.
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { TopAnalogsResponseDto } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

const TOP_ANALOGS_PATH = '/api/v1/analytics/top-analogs'

export type TopAnalogsData = TopAnalogsResponseDto

export async function fetchTopAnalogs(tenantId: string, period: string): Promise<TopAnalogsData> {
  return httpGetJson<TopAnalogsData>(TOP_ANALOGS_PATH, { tenantId, period })
}

export function topAnalogsQueryKey(tenantId: string, period: string): readonly unknown[] {
  return ['admin', 'analytics', 'top-analogs', tenantId, period] as const
}

export function useTopAnalogs(tenantId: string | null, period: string): UseQueryResult<TopAnalogsData, HttpError> {
  return useQuery<TopAnalogsData, HttpError>({
    queryKey: topAnalogsQueryKey(tenantId ?? '', period),
    queryFn: () => fetchTopAnalogs(tenantId ?? '', period),
    enabled: tenantId !== null,
  })
}

export type { HttpError }
