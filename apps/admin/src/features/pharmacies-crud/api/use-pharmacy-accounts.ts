// Бэкенд ждёт bracket-ключи (filter[status]/filter[chainId]/filter[name][like]) — маппинг camelCase→bracket только здесь.
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { PharmacyAccountAdminSummaryDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, type HttpError, type QueryParams } from '@/shared/api/http-client'

const PHARMACY_ACCOUNTS_PATH = '/api/v1/pharmacy-accounts'
const DEFAULT_LIMIT = 50

export interface PharmacyAccountsFilters {
  readonly status: string | undefined
  readonly chainId: string | undefined
  readonly name: string | undefined
}

const FILTER_KEYS: readonly (keyof PharmacyAccountsFilters)[] = ['status', 'chainId', 'name']

function readFilters(searchParams: URLSearchParams): PharmacyAccountsFilters {
  return {
    status: searchParams.get('status') ?? undefined,
    chainId: searchParams.get('chainId') ?? undefined,
    name: searchParams.get('name') ?? undefined,
  }
}

function toQueryParams(filters: PharmacyAccountsFilters, cursor: string | null, limit: number): QueryParams {
  return {
    limit: String(limit),
    cursor: cursor ?? undefined,
    'filter[status]': filters.status,
    'filter[chainId]': filters.chainId,
    'filter[name][like]': filters.name,
  }
}

export interface PharmacyAccountsPageResult {
  readonly items: readonly PharmacyAccountAdminSummaryDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export async function fetchPharmacyAccountsPage(
  filters: PharmacyAccountsFilters,
  cursor: string | null,
  limit: number,
): Promise<PharmacyAccountsPageResult> {
  const params = toQueryParams(filters, cursor, limit)
  const result = await httpGetJsonWithMeta<readonly PharmacyAccountAdminSummaryDto[]>(PHARMACY_ACCOUNTS_PATH, params)
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

export function pharmacyAccountsQueryKey(filters: PharmacyAccountsFilters, cursor: string | null): readonly unknown[] {
  return ['admin', 'pharmacy-accounts', 'list', filters, cursor] as const
}

export function usePharmacyAccounts(
  filters: PharmacyAccountsFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<PharmacyAccountsPageResult, HttpError> {
  return useQuery<PharmacyAccountsPageResult, HttpError>({
    queryKey: pharmacyAccountsQueryKey(filters, cursor),
    queryFn: () => fetchPharmacyAccountsPage(filters, cursor, limit),
  })
}

export interface UsePharmacyAccountsFiltersResult {
  readonly filters: PharmacyAccountsFilters
  readonly setFilter: (key: keyof PharmacyAccountsFilters, value: string | undefined) => void
  readonly resetFilters: () => void
}

export function usePharmacyAccountsFilters(): UsePharmacyAccountsFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => readFilters(searchParams), [searchParams])

  const setFilter = useCallback(
    (key: keyof PharmacyAccountsFilters, value: string | undefined): void => {
      const next = new URLSearchParams(searchParams)
      if (value === undefined || value.length === 0) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const resetFilters = useCallback((): void => {
    const next = new URLSearchParams(searchParams)
    for (const key of FILTER_KEYS) {
      next.delete(key)
    }
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  return { filters, setFilter, resetFilters }
}

export type { HttpError }
