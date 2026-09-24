// Фильтры синхронизированы с URL (шарабельная ссылка); курсор пагинации — локальное состояние
// страницы, не URL, иначе "назад" в браузере ломал бы накопленный список "load more".
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { AuditLogCategory, AuditLogEntryDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, type HttpError, type QueryParams } from '@/shared/api/http-client'

const AUDIT_LOG_PATH = '/api/v1/audit-log'
const DEFAULT_LIMIT = 50

export interface AuditLogFilters {
  readonly category: AuditLogCategory | undefined
  readonly entityType: string | undefined
  readonly entityId: string | undefined
  readonly actorUserId: string | undefined
  readonly tenantId: string | undefined
  readonly createdAtFrom: string | undefined
  readonly createdAtTo: string | undefined
}

const FILTER_KEYS: readonly (keyof AuditLogFilters)[] = [
  'category',
  'entityType',
  'entityId',
  'actorUserId',
  'tenantId',
  'createdAtFrom',
  'createdAtTo',
]

function readFilters(searchParams: URLSearchParams): AuditLogFilters {
  return {
    category: (searchParams.get('category') ?? undefined) as AuditLogCategory | undefined,
    entityType: searchParams.get('entityType') ?? undefined,
    entityId: searchParams.get('entityId') ?? undefined,
    actorUserId: searchParams.get('actorUserId') ?? undefined,
    tenantId: searchParams.get('tenantId') ?? undefined,
    createdAtFrom: searchParams.get('createdAtFrom') ?? undefined,
    createdAtTo: searchParams.get('createdAtTo') ?? undefined,
  }
}

export interface AuditLogPageResult {
  readonly items: readonly AuditLogEntryDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export async function fetchAuditLogPage(
  filters: AuditLogFilters,
  cursor: string | null,
  limit: number,
): Promise<AuditLogPageResult> {
  const params: QueryParams = { limit: String(limit), cursor: cursor ?? undefined, ...filters }
  const result = await httpGetJsonWithMeta<readonly AuditLogEntryDto[]>(AUDIT_LOG_PATH, params)
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

export function auditLogQueryKey(filters: AuditLogFilters, cursor: string | null): readonly unknown[] {
  return ['admin', 'audit-log', 'list', filters, cursor] as const
}

export function useAuditLog(
  filters: AuditLogFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<AuditLogPageResult, HttpError> {
  return useQuery<AuditLogPageResult, HttpError>({
    queryKey: auditLogQueryKey(filters, cursor),
    queryFn: () => fetchAuditLogPage(filters, cursor, limit),
  })
}

export interface UseAuditLogFiltersResult {
  readonly filters: AuditLogFilters
  readonly setFilter: (key: keyof AuditLogFilters, value: string | undefined) => void
  readonly resetFilters: () => void
}

export function useAuditLogFilters(): UseAuditLogFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => readFilters(searchParams), [searchParams])

  const setFilter = useCallback(
    (key: keyof AuditLogFilters, value: string | undefined): void => {
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
