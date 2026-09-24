/**
 * `use-tenants.ts` (EP-15, DTJ-351) — TanStack Query хуки над `GET /api/v1/tenants`,
 * `GET /api/v1/tenants/:id`, `PATCH /api/v1/tenant-settings/:tenantId` (`adminRequest`,
 * `admin-client.ts`, DTJ-350 — единый разбор `{error:{code,message,details}}`).
 *
 * Отдельный `api/`-файл (в отличие от `feature-flags-page.tsx`, где запросы инлайн) — тикет
 * `files_owned` явно заводит его: ДВА компонента (`tenants-list-page.tsx`/
 * `tenant-settings-form.tsx`) делят один и тот же список/детали, инлайн означал бы дублирование.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { TenantDetailDto, TenantSettingsPatchDto, TenantSummaryDto } from '@dorutj/contracts'
import { adminRequest, type AdminApiError } from '@/shared/api/admin-client'

const TENANTS_PATH = '/tenants'
const TENANT_SETTINGS_PATH = '/tenant-settings'
/** Волна 1 — без "load more" в UI (тот же class упрощения, что `use-support-tickets.ts`). */
const LIST_LIMIT = '100'

interface ListResponse {
  readonly data: readonly TenantSummaryDto[]
}
interface DetailResponse {
  readonly data: TenantDetailDto
}

export function tenantsListQueryKey(): readonly unknown[] {
  return ['admin', 'tenants', 'list'] as const
}

export function tenantQueryKey(tenantId: string): readonly unknown[] {
  return ['admin', 'tenants', 'detail', tenantId] as const
}

export function useTenantsList(): UseQueryResult<readonly TenantSummaryDto[], AdminApiError> {
  return useQuery({
    queryKey: tenantsListQueryKey(),
    queryFn: () => adminRequest<ListResponse>(`${TENANTS_PATH}?limit=${LIST_LIMIT}`).then((r) => r.data),
  })
}

export function useTenant(tenantId: string | undefined): UseQueryResult<TenantDetailDto, AdminApiError> {
  return useQuery({
    queryKey: tenantQueryKey(tenantId ?? ''),
    queryFn: () => adminRequest<DetailResponse>(`${TENANTS_PATH}/${tenantId ?? ''}`).then((r) => r.data),
    enabled: tenantId !== undefined,
  })
}

export interface UpdateTenantSettingsInput {
  readonly tenantId: string
  readonly patch: TenantSettingsPatchDto
}

export function useUpdateTenantSettings(): UseMutationResult<TenantDetailDto, AdminApiError, UpdateTenantSettingsInput> {
  const queryClient = useQueryClient()
  return useMutation<TenantDetailDto, AdminApiError, UpdateTenantSettingsInput>({
    mutationFn: ({ tenantId, patch }) =>
      adminRequest<DetailResponse>(`${TENANT_SETTINGS_PATH}/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then((r) => r.data),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: tenantsListQueryKey() })
      queryClient.setQueryData(tenantQueryKey(updated.id), updated)
    },
  })
}
