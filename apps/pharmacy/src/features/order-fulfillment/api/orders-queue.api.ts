import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { PharmacyTerminalQueueItemDto, ReclaimOrderReason } from '@dorutj/contracts'
import { httpRequestJson, HttpError } from '@/shared/api/http-client'
import { applyAcceptConflict, applyOptimisticAccept } from '@/features/order-fulfillment/model/order-queue.model'

// TODO(DTJ-308): заменить/дополнить опрос точечным WS-патчем (applyQueuePatch), когда появится канал терминала.

const ORDER_QUEUE_PATH = '/api/v1/orders?sort=priority'
const ORDER_QUEUE_LIMIT_PATH = `${ORDER_QUEUE_PATH}&limit=50`
export const ORDER_QUEUE_QUERY_KEY = ['order-fulfillment', 'order-queue'] as const
export const ORDER_QUEUE_POLL_INTERVAL_MS = 10_000

export type OrderQueueItems = readonly PharmacyTerminalQueueItemDto[]

// meta.groupedBy (сеть pharmacy_admin) не распаковывается — несёт только orderId по pharmacyId, без названия точки для заголовка секции.
function fetchOrderQueue(): Promise<OrderQueueItems> {
  return httpRequestJson<OrderQueueItems>(ORDER_QUEUE_LIMIT_PATH)
}

export function useOrderQueue(): UseQueryResult<OrderQueueItems, HttpError> {
  return useQuery<OrderQueueItems, HttpError>({
    queryKey: ORDER_QUEUE_QUERY_KEY,
    queryFn: fetchOrderQueue,
    refetchInterval: ORDER_QUEUE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true, // терминал может быть свёрнут — опрос не должен останавливаться
  })
}

interface AcceptOrderResponseData {
  readonly id: string
  readonly status: 'processing'
  readonly slaDeadlineAt: string
  readonly assignedPharmacistId: string
}

interface AlreadyClaimedDetails {
  readonly assignedPharmacistId: string
  readonly assignedPharmacistName: string | null
}

function isAlreadyClaimedDetails(details: unknown): details is AlreadyClaimedDetails {
  if (typeof details !== 'object' || details === null) return false
  return typeof (details as { assignedPharmacistId?: unknown }).assignedPharmacistId === 'string'
}

export interface AcceptOrderInput {
  readonly orderId: string
  readonly idempotencyKey: string
}

function postWithIdempotencyKey<T>(path: string, idempotencyKey: string): Promise<T> {
  return httpRequestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: '{}',
  })
}

// 409 ORDER_ALREADY_CLAIMED — патч на реального владельца из error.details, не голый rollback (иначе карточка ложно вернётся в «Новые»).
export function useAcceptOrder(currentPharmacistId: string): UseMutationResult<AcceptOrderResponseData, HttpError, AcceptOrderInput> {
  const queryClient = useQueryClient()

  return useMutation<AcceptOrderResponseData, HttpError, AcceptOrderInput, { readonly previous: OrderQueueItems | undefined }>({
    mutationKey: ['order-fulfillment', 'accept-order'],
    retry: 0,
    mutationFn: ({ orderId, idempotencyKey }) =>
      postWithIdempotencyKey<AcceptOrderResponseData>(`/api/v1/orders/${orderId}/accept`, idempotencyKey),
    onMutate: async ({ orderId }) => {
      await queryClient.cancelQueries({ queryKey: ORDER_QUEUE_QUERY_KEY })
      const previous = queryClient.getQueryData<OrderQueueItems>(ORDER_QUEUE_QUERY_KEY)
      if (previous !== undefined) {
        queryClient.setQueryData<OrderQueueItems>(ORDER_QUEUE_QUERY_KEY, applyOptimisticAccept(previous, orderId, currentPharmacistId))
      }
      return { previous }
    },
    onError: (error, { orderId }, context) => {
      if (error instanceof HttpError && error.code === 'ORDER_ALREADY_CLAIMED' && isAlreadyClaimedDetails(error.details)) {
        const current = queryClient.getQueryData<OrderQueueItems>(ORDER_QUEUE_QUERY_KEY) ?? context?.previous
        if (current !== undefined) {
          queryClient.setQueryData<OrderQueueItems>(ORDER_QUEUE_QUERY_KEY, applyAcceptConflict(current, orderId, error.details))
        }
        return
      }
      if (context?.previous !== undefined) {
        queryClient.setQueryData(ORDER_QUEUE_QUERY_KEY, context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ORDER_QUEUE_QUERY_KEY })
    },
  })
}

export interface ReclaimOrderInput {
  readonly orderId: string
  readonly reason: ReclaimOrderReason
  readonly idempotencyKey: string
}

interface ReclaimOrderResponseData {
  readonly id: string
  readonly assignedPharmacistId: string
  readonly slaDeadlineAt: string | null
}

export function useReclaimOrder(): UseMutationResult<ReclaimOrderResponseData, HttpError, ReclaimOrderInput> {
  const queryClient = useQueryClient()
  return useMutation<ReclaimOrderResponseData, HttpError, ReclaimOrderInput>({
    mutationKey: ['order-fulfillment', 'reclaim-order'],
    retry: 0,
    mutationFn: ({ orderId, reason, idempotencyKey }) =>
      httpRequestJson<ReclaimOrderResponseData>(`/api/v1/orders/${orderId}/reclaim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORDER_QUEUE_QUERY_KEY })
    },
  })
}
