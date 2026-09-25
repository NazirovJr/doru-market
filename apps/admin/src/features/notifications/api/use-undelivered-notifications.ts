// Курсорная пагинация, тот же приём, что features/audit-log/api/use-audit-log.ts. Без фильтров — экран их не специфицирует.
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { httpGetJsonWithMeta, type HttpError, type QueryParams } from '@/shared/api/http-client'

const UNDELIVERED_NOTIFICATIONS_PATH = '/api/v1/notifications/undelivered'
const DEFAULT_LIMIT = 50

export interface UndeliveredChannelAttemptDto {
  readonly channel: string
  readonly status: string
  readonly failedReason: string | null
  readonly attemptedAt: string
}

export interface UndeliveredNotificationDto {
  readonly userId: string
  readonly tenantId: string
  readonly eventType: string
  readonly sourceEventId: string
  readonly attempts: readonly UndeliveredChannelAttemptDto[]
  readonly lastAttemptAt: string
}

export interface UndeliveredNotificationsPageResult {
  readonly items: readonly UndeliveredNotificationDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export async function fetchUndeliveredNotificationsPage(cursor: string | null, limit: number): Promise<UndeliveredNotificationsPageResult> {
  const params: QueryParams = { limit: String(limit), cursor: cursor ?? undefined }
  const result = await httpGetJsonWithMeta<readonly UndeliveredNotificationDto[]>(UNDELIVERED_NOTIFICATIONS_PATH, params)
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

export function undeliveredNotificationsQueryKey(cursor: string | null): readonly unknown[] {
  return ['admin', 'notifications', 'undelivered', cursor] as const
}

export function useUndeliveredNotifications(
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<UndeliveredNotificationsPageResult, HttpError> {
  return useQuery<UndeliveredNotificationsPageResult, HttpError>({
    queryKey: undeliveredNotificationsQueryKey(cursor),
    queryFn: () => fetchUndeliveredNotificationsPage(cursor, limit),
  })
}

export type { HttpError }
