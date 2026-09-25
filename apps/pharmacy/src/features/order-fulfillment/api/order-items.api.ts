import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { OrderItemDto, ReportItemIssueReason } from '@dorutj/contracts'
import { httpRequestJson, HttpError } from '@/shared/api/http-client'
import { mergeUpdatedItem, type PickingOrder } from '@/features/order-fulfillment/model/picking.model'

// TODO(DTJ-308): заменить опрос точечным WS-патчем, когда появится канал терминала.
const ORDER_DETAIL_POLL_INTERVAL_MS = 4_000

export function orderDetailQueryKey(orderId: string): readonly [string, string, string] {
  return ['order-fulfillment', 'order-detail', orderId] as const
}

function fetchOrderDetail(orderId: string): Promise<PickingOrder> {
  return httpRequestJson<PickingOrder>(`/api/v1/orders/${orderId}`)
}

// Опрос чаще, чем в очереди — опоздавшая отмена держит фармацевта в работе над мёртвым заказом.
export function useOrderDetail(orderId: string): UseQueryResult<PickingOrder, HttpError> {
  return useQuery<PickingOrder, HttpError>({
    queryKey: orderDetailQueryKey(orderId),
    queryFn: () => fetchOrderDetail(orderId),
    refetchInterval: ORDER_DETAIL_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })
}

interface PostItemActionParams {
  readonly orderId: string
  readonly itemId: string
  readonly action: string
  readonly idempotencyKey: string
  readonly body: unknown
}

function postItemAction<T>({ orderId, itemId, action, idempotencyKey, body }: PostItemActionParams): Promise<T> {
  return httpRequestJson<T>(`/api/v1/orders/${orderId}/items/${itemId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
}

function patchItemInCache(queryClient: ReturnType<typeof useQueryClient>, orderId: string, updated: OrderItemDto): void {
  queryClient.setQueryData<PickingOrder>(orderDetailQueryKey(orderId), (current) =>
    current === undefined ? current : { ...current, items: mergeUpdatedItem(current.items, updated) },
  )
}

export interface ScanOrderItemInput {
  readonly itemId: string
  readonly rawBarcode: string
  readonly idempotencyKey: string
}

export function useScanOrderItem(orderId: string): UseMutationResult<OrderItemDto, HttpError, ScanOrderItemInput> {
  const queryClient = useQueryClient()
  return useMutation<OrderItemDto, HttpError, ScanOrderItemInput>({
    mutationKey: ['order-fulfillment', 'scan-order-item'],
    retry: 0,
    // `manualEntry: true` — веб-версия без камеры, ручной ввод штрихкода единственный путь.
    mutationFn: ({ itemId, rawBarcode, idempotencyKey }) =>
      postItemAction<OrderItemDto>({ orderId, itemId, action: 'scan', idempotencyKey, body: { rawBarcode, manualEntry: true } }),
    onSuccess: (updated) => { patchItemInCache(queryClient, orderId, updated) },
    onError: (error) => {
      // `409` не говорит, каким РЕАЛЬНО стало состояние позиции — рефетч вместо угадывания.
      if (error instanceof HttpError && error.code === 'ITEM_ALREADY_SCANNED') {
        void queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) })
      }
    },
  })
}

export interface ReportItemIssueInput {
  readonly itemId: string
  readonly reason: ReportItemIssueReason
  readonly note?: string
  readonly idempotencyKey: string
}

export function useReportItemIssue(orderId: string): UseMutationResult<OrderItemDto, HttpError, ReportItemIssueInput> {
  const queryClient = useQueryClient()
  return useMutation<OrderItemDto, HttpError, ReportItemIssueInput>({
    mutationKey: ['order-fulfillment', 'report-item-issue'],
    retry: 0,
    mutationFn: ({ itemId, reason, note, idempotencyKey }) =>
      postItemAction<OrderItemDto>({
        orderId,
        itemId,
        action: 'report-issue',
        idempotencyKey,
        body: note === undefined ? { reason } : { reason, note },
      }),
    onSuccess: (updated) => { patchItemInCache(queryClient, orderId, updated) },
  })
}
