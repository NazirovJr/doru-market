// Фильтры синхронизированы с URL (та же схема, что features/audit-log/api/use-audit-log.ts);
// курсор пагинации — локальное состояние страницы, не URL (см. её JSDoc про "load more"/"назад").
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { UserRole, UserSummaryDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, httpPatchJson, httpPostJson, type HttpError, type QueryParams } from '@/shared/api/http-client'

const USERS_PATH = '/api/v1/users'
const DEFAULT_LIMIT = 50

export interface UsersFilters {
  readonly role: UserRole | undefined
  readonly phoneNumber: string | undefined
  readonly tenantId: string | undefined
}

const FILTER_KEYS: readonly (keyof UsersFilters)[] = ['role', 'phoneNumber', 'tenantId']

function readFilters(searchParams: URLSearchParams): UsersFilters {
  return {
    role: (searchParams.get('role') ?? undefined) as UserRole | undefined,
    phoneNumber: searchParams.get('phoneNumber') ?? undefined,
    tenantId: searchParams.get('tenantId') ?? undefined,
  }
}

export interface UsersPageResult {
  readonly items: readonly UserSummaryDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export async function fetchUsersPage(filters: UsersFilters, cursor: string | null, limit: number): Promise<UsersPageResult> {
  const params: QueryParams = { limit: String(limit), cursor: cursor ?? undefined, ...filters }
  const result = await httpGetJsonWithMeta<readonly UserSummaryDto[]>(USERS_PATH, params)
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

export function usersQueryKey(filters: UsersFilters, cursor: string | null): readonly unknown[] {
  return ['admin', 'users', 'list', filters, cursor] as const
}

export function useUsers(
  filters: UsersFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<UsersPageResult, HttpError> {
  return useQuery<UsersPageResult, HttpError>({
    queryKey: usersQueryKey(filters, cursor),
    queryFn: () => fetchUsersPage(filters, cursor, limit),
  })
}

export interface UseUsersFiltersResult {
  readonly filters: UsersFilters
  readonly setFilter: (key: keyof UsersFilters, value: string | undefined) => void
  readonly resetFilters: () => void
}

export function useUsersFilters(): UseUsersFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => readFilters(searchParams), [searchParams])

  const setFilter = useCallback(
    (key: keyof UsersFilters, value: string | undefined): void => {
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

function invalidateUsersLists(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'list'] })
}

export function useDeactivateUser(): UseMutationResult<UserSummaryDto, HttpError, string> {
  const queryClient = useQueryClient()
  return useMutation<UserSummaryDto, HttpError, string>({
    mutationFn: (userId) => httpPatchJson<UserSummaryDto>(`${USERS_PATH}/${userId}`, { isActive: false }),
    onSuccess: () => { invalidateUsersLists(queryClient) },
  })
}

export interface ChangeStaffRoleInput {
  readonly userId: string
  readonly newRole: 'pharmacist' | 'courier' | 'pharmacy_admin'
}

export function useChangeStaffRole(): UseMutationResult<UserSummaryDto, HttpError, ChangeStaffRoleInput> {
  const queryClient = useQueryClient()
  return useMutation<UserSummaryDto, HttpError, ChangeStaffRoleInput>({
    mutationFn: ({ userId, newRole }) => httpPatchJson<UserSummaryDto>(`${USERS_PATH}/${userId}/role`, { newRole }),
    onSuccess: () => { invalidateUsersLists(queryClient) },
  })
}

export interface GrantPlatformRoleInput {
  readonly userId: string
  readonly role: 'super_admin' | 'support_agent'
  readonly reason: string
}

export function useGrantPlatformRole(): UseMutationResult<UserSummaryDto, HttpError, GrantPlatformRoleInput> {
  const queryClient = useQueryClient()
  return useMutation<UserSummaryDto, HttpError, GrantPlatformRoleInput>({
    mutationFn: ({ userId, role, reason }) =>
      httpPostJson<UserSummaryDto>(`${USERS_PATH}/${userId}/grant-platform-role`, { role, reason }),
    onSuccess: () => { invalidateUsersLists(queryClient) },
  })
}

export type { HttpError }
