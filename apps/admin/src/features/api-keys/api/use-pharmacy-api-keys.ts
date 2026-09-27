// DTJ-365: hooks CRUD ключей 1С аптеки. Rotate/requireMtls не реализованы (блокер миграции,
// см. отчёт сдачи) — здесь нет соответствующих мутаций.
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { PharmacyAccountAdminSummaryDto, PharmacyApiKeyCreatedDto, PharmacyApiKeySummaryDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, httpPostJson, type HttpError } from '@/shared/api/http-client'

function apiKeysPath(pharmacyId: string): string {
  return `/api/v1/pharmacy-accounts/${pharmacyId}/api-keys`
}

// Не переиспользует features/pharmacies-crud/api (горизонтальный импорт между фичами запрещён,
// `fe-features-are-isolated`, AGENTS.md §5) — тот же REST-эндпоинт, свой тонкий запрос.
export function useOwnPharmacies(): UseQueryResult<readonly PharmacyAccountAdminSummaryDto[], HttpError> {
  return useQuery<readonly PharmacyAccountAdminSummaryDto[], HttpError>({
    queryKey: ['admin', 'api-keys', 'own-pharmacies'] as const,
    queryFn: async () => {
      const result = await httpGetJsonWithMeta<readonly PharmacyAccountAdminSummaryDto[]>('/api/v1/pharmacy-accounts', { scope: 'own' })
      return result.data
    },
  })
}

export function pharmacyApiKeysQueryKey(pharmacyId: string | null): readonly unknown[] {
  return ['admin', 'pharmacy-api-keys', 'list', pharmacyId] as const
}

export function usePharmacyApiKeys(pharmacyId: string | null): UseQueryResult<readonly PharmacyApiKeySummaryDto[], HttpError> {
  return useQuery<readonly PharmacyApiKeySummaryDto[], HttpError>({
    queryKey: pharmacyApiKeysQueryKey(pharmacyId),
    queryFn: async () => {
      if (pharmacyId === null) return []
      const result = await httpGetJsonWithMeta<readonly PharmacyApiKeySummaryDto[]>(apiKeysPath(pharmacyId))
      return result.data
    },
    enabled: pharmacyId !== null,
  })
}

function invalidatePharmacyApiKeys(queryClient: ReturnType<typeof useQueryClient>, pharmacyId: string): void {
  void queryClient.invalidateQueries({ queryKey: pharmacyApiKeysQueryKey(pharmacyId) })
}

export function useCreatePharmacyApiKey(pharmacyId: string): UseMutationResult<PharmacyApiKeyCreatedDto, HttpError, void> {
  const queryClient = useQueryClient()
  return useMutation<PharmacyApiKeyCreatedDto, HttpError>({
    mutationFn: () => httpPostJson<PharmacyApiKeyCreatedDto>(apiKeysPath(pharmacyId), {}),
    onSuccess: () => { invalidatePharmacyApiKeys(queryClient, pharmacyId) },
  })
}

export interface RevokePharmacyApiKeyInput {
  readonly keyId: string
  readonly reason: string
}

export function useRevokePharmacyApiKey(pharmacyId: string): UseMutationResult<unknown, HttpError, RevokePharmacyApiKeyInput> {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, RevokePharmacyApiKeyInput>({
    mutationFn: ({ keyId, reason }) => httpPostJson(`${apiKeysPath(pharmacyId)}/${keyId}/revoke`, { reason }),
    onSuccess: () => { invalidatePharmacyApiKeys(queryClient, pharmacyId) },
  })
}

export type { HttpError }
