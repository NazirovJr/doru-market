import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { TenantMetaDto } from '@dorutj/contracts'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'

const TENANT_META_PATH = '/api/v1/tenant/meta'
const MINUTES_PER_STALE_WINDOW = 30
const MS_PER_MINUTE = 60_000
// SLA-настройки тенанта (DTJ-033) меняются редко — долгий staleTime вместо повторного запроса на каждый рендер.
const TENANT_META_STALE_TIME_MS = MINUTES_PER_STALE_WINDOW * MS_PER_MINUTE

/** `enabled=false` — для мест, где пороги не нужны без данных для их применения (например `StaleDataBadge` без батчей). */
export function useTenantMeta(enabled = true): UseQueryResult<TenantMetaDto, HttpError> {
  return useQuery<TenantMetaDto, HttpError>({
    queryKey: ['tenant', 'meta'],
    queryFn: () => httpRequestJson<TenantMetaDto>(TENANT_META_PATH),
    staleTime: TENANT_META_STALE_TIME_MS,
    enabled,
  })
}
