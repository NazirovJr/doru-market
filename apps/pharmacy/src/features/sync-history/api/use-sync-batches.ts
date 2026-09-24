import { useInfiniteQuery, useQuery, type UseInfiniteQueryResult, type UseQueryResult } from '@tanstack/react-query'
import type {
  InventoryPendingModerationCountResponse,
  InventorySyncBatchChannelDto,
  InventorySyncBatchListItemDto,
  InventorySyncRowErrorResponseDto,
} from '@dorutj/contracts'
import { httpGetJsonWithMeta, httpRequest, type HttpError, type JsonMeta } from '@/shared/api/http-client'
import { useAuthStore } from '@/shared/api/auth-store'

// Бэкенд не читает channel вовсе (сверено с контроллером/сервисом) — отправляем его на будущее, а сужение списка делаем клиентски.
const SYNC_BATCHES_PATH = '/api/v1/inventory-sync-batches'

export type SyncChannelFilter = 'all' | InventorySyncBatchChannelDto

export const SYNC_CHANNEL_FILTERS: readonly SyncChannelFilter[] = ['all', 'rest', 'excel', 'manual']

interface SyncBatchesPage {
  readonly items: readonly InventorySyncBatchListItemDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

interface SyncBatchesPaginationMeta {
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

function isSyncBatchesPaginationMeta(value: unknown): value is SyncBatchesPaginationMeta {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { readonly nextCursor?: unknown; readonly hasMore?: unknown }
  return (typeof candidate.nextCursor === 'string' || candidate.nextCursor === null) && typeof candidate.hasMore === 'boolean'
}

function readPagination(meta: JsonMeta | undefined): SyncBatchesPaginationMeta | null {
  const pagination = (meta as { readonly pagination?: unknown } | undefined)?.pagination
  return isSyncBatchesPaginationMeta(pagination) ? pagination : null
}

async function fetchSyncBatchesPage(channel: SyncChannelFilter, cursor: string | undefined): Promise<SyncBatchesPage> {
  const params = channel === 'all' ? { cursor } : { cursor, channel }
  const envelope = await httpGetJsonWithMeta<readonly InventorySyncBatchListItemDto[]>(SYNC_BATCHES_PATH, params)
  const pagination = readPagination(envelope.meta)
  return {
    items: envelope.data,
    nextCursor: pagination?.nextCursor ?? null,
    hasMore: pagination?.hasMore ?? false,
  }
}

export function filterBatchesByChannel(
  items: readonly InventorySyncBatchListItemDto[],
  channel: SyncChannelFilter,
): readonly InventorySyncBatchListItemDto[] {
  return channel === 'all' ? items : items.filter((item) => item.channel === channel)
}

export interface UseSyncBatchesResult {
  readonly items: readonly InventorySyncBatchListItemDto[]
  readonly isInitialLoading: boolean
  readonly isFetchingNextPage: boolean
  readonly hasNextPage: boolean
  readonly error: HttpError | null
  readonly fetchNextPage: () => void
}

export function useSyncBatches(channel: SyncChannelFilter): UseSyncBatchesResult {
  const query: UseInfiniteQueryResult<{ pages: SyncBatchesPage[] }, HttpError> = useInfiniteQuery({
    queryKey: ['inventory', 'sync-batches', channel],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchSyncBatchesPage(channel, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: SyncBatchesPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    retry: 0,
  })

  const allItems = query.data?.pages.flatMap((page) => page.items) ?? []

  return {
    items: filterBatchesByChannel(allItems, channel),
    isInitialLoading: query.isPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    error: query.error ?? null,
    fetchNextPage: (): void => {
      void query.fetchNextPage()
    },
  }
}

function errorsPath(batchId: string): string {
  return `${SYNC_BATCHES_PATH}/${batchId}/errors`
}

// `enabled` управляется раскрытием строки — ленивая загрузка, не N+1 на список.
export function useBatchRowErrors(
  batchId: string,
  enabled: boolean,
): UseQueryResult<readonly InventorySyncRowErrorResponseDto[], HttpError> {
  return useQuery<readonly InventorySyncRowErrorResponseDto[], HttpError>({
    queryKey: ['inventory', 'sync-batches', batchId, 'errors'],
    queryFn: () => httpGetJsonWithMeta<readonly InventorySyncRowErrorResponseDto[]>(errorsPath(batchId)).then((r) => r.data),
    enabled,
    retry: 0,
  })
}

function errorReportPath(sourceUploadId: string): string {
  return `${SYNC_BATCHES_PATH}/${sourceUploadId}/error-report`
}

const ERROR_REPORT_FILENAME = 'doru-tj-inventory-import-errors.xlsx'

// Прямая ссылка не донесла бы Authorization до защищённого эндпоинта — fetch + blob.
export async function downloadSyncErrorReport(sourceUploadId: string): Promise<void> {
  const response = await httpRequest(errorReportPath(sourceUploadId))
  if (!response.ok) {
    throw new Error(`Failed to download ${errorReportPath(sourceUploadId)}: HTTP ${String(response.status)}`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = ERROR_REPORT_FILENAME
  link.click()
  URL.revokeObjectURL(objectUrl)
}

const PENDING_MODERATION_COUNT_PATH = `${SYNC_BATCHES_PATH}/pending-moderation-count`
const JWT_SEGMENT_COUNT = 3
const BASE64_BLOCK_SIZE = 4

// Декодирование JWT на клиенте — только для UX (какой pharmacyId запросить), реальный скоуп проверяет бэкенд.
function base64UrlToBase64(segment: string): string {
  const withStdAlphabet = segment.replaceAll('-', '+').replaceAll('_', '/')
  const paddingNeeded = (BASE64_BLOCK_SIZE - (withStdAlphabet.length % BASE64_BLOCK_SIZE)) % BASE64_BLOCK_SIZE
  return withStdAlphabet + '='.repeat(paddingNeeded)
}

function decodePharmacyIdFromAccessToken(token: string | null): string | null {
  if (token === null || token.length === 0) {
    return null
  }
  const parts = token.split('.')
  const payloadSegment = parts[1]
  if (parts.length !== JWT_SEGMENT_COUNT || payloadSegment === undefined) {
    return null
  }
  try {
    const json = atob(base64UrlToBase64(payloadSegment))
    const parsed: unknown = JSON.parse(json)
    const pharmacyId = (parsed as { readonly pharmacyId?: unknown }).pharmacyId
    return typeof pharmacyId === 'string' ? pharmacyId : null
  } catch {
    return null
  }
}

export function useCurrentPharmacyId(): string | null {
  return decodePharmacyIdFromAccessToken(useAuthStore((state) => state.accessToken))
}

export function usePendingModerationCount(
  pharmacyId: string | null,
): UseQueryResult<InventoryPendingModerationCountResponse, HttpError> {
  return useQuery<InventoryPendingModerationCountResponse, HttpError>({
    queryKey: ['inventory', 'sync-batches', 'pending-moderation-count', pharmacyId],
    queryFn: () =>
      httpGetJsonWithMeta<InventoryPendingModerationCountResponse>(PENDING_MODERATION_COUNT_PATH, {
        pharmacyId: pharmacyId ?? undefined,
      }).then((r) => r.data),
    enabled: pharmacyId !== null,
    retry: 0,
  })
}
