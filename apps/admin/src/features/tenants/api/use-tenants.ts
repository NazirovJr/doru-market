// Отдельный api/-файл — список и форма настроек делят один и тот же список/детали.
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { TenantDetailDto, TenantSettingsPatchDto, TenantSummaryDto } from '@dorutj/contracts'
import { adminRequest, type AdminApiError } from '@/shared/api/admin-client'

const TENANTS_PATH = '/tenants'
const TENANT_SETTINGS_PATH = '/tenant-settings'
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
