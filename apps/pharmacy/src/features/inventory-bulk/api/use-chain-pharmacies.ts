// Список аптек сети через уже существующий GET /pharmacy-accounts?scope=own (chainId резолвится сервером).
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, HttpError } from '@/shared/api/http-client'

const PHARMACY_ACCOUNTS_PATH = '/api/v1/pharmacy-accounts'
const CROSS_TENANT_ACCESS_DENIED = 'CROSS_TENANT_ACCESS_DENIED'

async function fetchChainPharmacies(): Promise<readonly PharmacyAccountAdminSummaryDto[]> {
  try {
    const result = await httpGetJsonWithMeta<readonly PharmacyAccountAdminSummaryDto[]>(PHARMACY_ACCOUNTS_PATH, {
      scope: 'own',
    })
    return result.data
  } catch (error) {
    // Аптека-привязанный пользователь (chainId=null) — трактуем как «нет сети», без ошибки в UI.
    if (error instanceof HttpError && error.code === CROSS_TENANT_ACCESS_DENIED) {
      return []
    }
    throw error
  }
}

export function chainPharmaciesQueryKey(): readonly unknown[] {
  return ['pharmacy', 'inventory-bulk', 'chain-pharmacies'] as const
}

/** `enabled` — вызывающий решает, нужен ли запрос вообще (только для роли `pharmacy_admin`). */
export function useChainPharmacies(enabled: boolean): UseQueryResult<readonly PharmacyAccountAdminSummaryDto[]> {
  return useQuery({
    queryKey: chainPharmaciesQueryKey(),
    queryFn: fetchChainPharmacies,
    enabled,
    retry: 0,
  })
}
