// Бэкенд ждёт bracket-ключи (filter[orderNumber]/filter[status]/…) — маппинг camelCase→bracket только здесь (тот же приём, что use-pharmacy-accounts.ts).
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type {
  AdminForceCancelOrderResultDto,
  AdminPaymentOverrideResultDto,
  OrderAdminSummaryDto,
  OrderDetailAdminDto,
} from '@dorutj/contracts'
import { httpGetJson, httpGetJsonWithMeta, httpPostJson, type HttpError, type QueryParams } from '@/shared/api/http-client'

const ORDERS_PATH = '/api/v1/admin/orders'
const DEFAULT_LIMIT = 50

export interface OrdersAdminFilters {
  readonly orderNumber: string | undefined
  readonly status: string | undefined
  readonly tenantId: string | undefined
  readonly pharmacyId: string | undefined
  readonly customerId: string | undefined
  readonly createdFrom: string | undefined
  readonly createdTo: string | undefined
}

const ANY_FILTER_KEYS: readonly (keyof OrdersAdminFilters)[] = [
  'orderNumber',
  'status',
  'tenantId',
  'pharmacyId',
  'customerId',
  'createdFrom',
  'createdTo',
]

function readAnyFilters(searchParams: URLSearchParams): OrdersAdminFilters {
  return {
    orderNumber: searchParams.get('orderNumber') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    tenantId: searchParams.get('tenantId') ?? undefined,
    pharmacyId: searchParams.get('pharmacyId') ?? undefined,
    customerId: searchParams.get('customerId') ?? undefined,
    createdFrom: searchParams.get('createdFrom') ?? undefined,
    createdTo: searchParams.get('createdTo') ?? undefined,
  }
}

export interface OrdersOwnFilters {
  readonly status: string | undefined
  readonly slaBreached: boolean | undefined
}

const OWN_FILTER_KEYS: readonly (keyof OrdersOwnFilters)[] = ['status', 'slaBreached']

function readOwnFilters(searchParams: URLSearchParams): OrdersOwnFilters {
  return {
    status: searchParams.get('status') ?? undefined,
    slaBreached: searchParams.get('slaBreached') === 'true' ? true : undefined,
  }
}

export interface OrdersAdminListOptions {
  readonly cursor: string | null
  readonly limit: number
  readonly scope?: 'own'
}

function toAnyQueryParams(filters: OrdersAdminFilters, options: OrdersAdminListOptions): QueryParams {
  return {
    limit: String(options.limit),
    cursor: options.cursor ?? undefined,
    'filter[orderNumber]': filters.orderNumber,
    'filter[status]': filters.status,
    'filter[tenantId]': filters.tenantId,
    'filter[pharmacyId]': filters.pharmacyId,
    'filter[customerId]': filters.customerId,
    'filter[createdAt][from]': filters.createdFrom,
    'filter[createdAt][to]': filters.createdTo,
  }
}

function toOwnQueryParams(filters: OrdersOwnFilters, options: OrdersAdminListOptions): QueryParams {
  return {
    scope: 'own',
    limit: String(options.limit),
    cursor: options.cursor ?? undefined,
    'filter[status]': filters.status,
    'filter[slaBreached]': filters.slaBreached === true ? 'true' : undefined,
  }
}

export interface OrdersAdminPageResult {
  readonly items: readonly OrderAdminSummaryDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

async function fetchOrdersAdminPage(params: QueryParams): Promise<OrdersAdminPageResult> {
  const result = await httpGetJsonWithMeta<readonly OrderAdminSummaryDto[]>(ORDERS_PATH, params)
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

export function ordersAdminQueryKey(filters: OrdersAdminFilters, cursor: string | null): readonly unknown[] {
  return ['admin', 'orders', 'any', filters, cursor] as const
}

export function useOrdersAdmin(
  filters: OrdersAdminFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<OrdersAdminPageResult, HttpError> {
  return useQuery<OrdersAdminPageResult, HttpError>({
    queryKey: ordersAdminQueryKey(filters, cursor),
    queryFn: () => fetchOrdersAdminPage(toAnyQueryParams(filters, { cursor, limit })),
  })
}

export function ownOrdersAdminQueryKey(filters: OrdersOwnFilters, cursor: string | null): readonly unknown[] {
  return ['admin', 'orders', 'own', filters, cursor] as const
}

export function useOwnOrdersAdmin(
  filters: OrdersOwnFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<OrdersAdminPageResult, HttpError> {
  return useQuery<OrdersAdminPageResult, HttpError>({
    queryKey: ownOrdersAdminQueryKey(filters, cursor),
    queryFn: () => fetchOrdersAdminPage(toOwnQueryParams(filters, { cursor, limit })),
  })
}

export function orderDetailAdminQueryKey(orderId: string): readonly unknown[] {
  return ['admin', 'orders', 'detail', orderId] as const
}

export function useOrderDetailAdmin(orderId: string | null): UseQueryResult<OrderDetailAdminDto, HttpError> {
  return useQuery<OrderDetailAdminDto, HttpError>({
    queryKey: orderDetailAdminQueryKey(orderId ?? ''),
    queryFn: () => httpGetJson<OrderDetailAdminDto>(`${ORDERS_PATH}/${orderId ?? ''}`),
    enabled: orderId !== null,
  })
}

export interface UseOrdersAdminFiltersResult {
  readonly filters: OrdersAdminFilters
  readonly setFilter: (key: keyof OrdersAdminFilters, value: string | undefined) => void
  readonly resetFilters: () => void
}

export function useOrdersAdminFilters(): UseOrdersAdminFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => readAnyFilters(searchParams), [searchParams])

  const setFilter = useCallback(
    (key: keyof OrdersAdminFilters, value: string | undefined): void => {
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
    for (const key of ANY_FILTER_KEYS) {
      next.delete(key)
    }
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  return { filters, setFilter, resetFilters }
}

export interface UseOwnOrdersAdminFiltersResult {
  readonly filters: OrdersOwnFilters
  readonly setStatus: (value: string | undefined) => void
  readonly setSlaBreached: (value: boolean) => void
  readonly resetFilters: () => void
}

export function useOwnOrdersAdminFilters(): UseOwnOrdersAdminFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => readOwnFilters(searchParams), [searchParams])

  const setStatus = useCallback(
    (value: string | undefined): void => {
      const next = new URLSearchParams(searchParams)
      if (value === undefined || value.length === 0) {
        next.delete('status')
      } else {
        next.set('status', value)
      }
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const setSlaBreached = useCallback(
    (value: boolean): void => {
      const next = new URLSearchParams(searchParams)
      if (value) {
        next.set('slaBreached', 'true')
      } else {
        next.delete('slaBreached')
      }
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const resetFilters = useCallback((): void => {
    const next = new URLSearchParams(searchParams)
    for (const key of OWN_FILTER_KEYS) {
      next.delete(key)
    }
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  return { filters, setStatus, setSlaBreached, resetFilters }
}

// DTJ-356 — payment-override/admin-force-cancel, инвалидируют карточку заказа при успехе.
export interface AdminPaymentOverrideInput {
  readonly reason: string
  readonly txId: string
  readonly amountDiram: string
  readonly paidAt: string
}

export function useAdminPaymentOverride(
  orderId: string,
): UseMutationResult<AdminPaymentOverrideResultDto, HttpError, AdminPaymentOverrideInput> {
  const queryClient = useQueryClient()
  return useMutation<AdminPaymentOverrideResultDto, HttpError, AdminPaymentOverrideInput>({
    mutationFn: (input) => httpPostJson<AdminPaymentOverrideResultDto>(`${ORDERS_PATH}/${orderId}/payment-override`, input),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: orderDetailAdminQueryKey(orderId) }) },
  })
}

export interface AdminForceCancelOrderInput {
  readonly reason: string
}

export function useAdminForceCancelOrder(
  orderId: string,
): UseMutationResult<AdminForceCancelOrderResultDto, HttpError, AdminForceCancelOrderInput> {
  const queryClient = useQueryClient()
  return useMutation<AdminForceCancelOrderResultDto, HttpError, AdminForceCancelOrderInput>({
    mutationFn: (input) => httpPostJson<AdminForceCancelOrderResultDto>(`${ORDERS_PATH}/${orderId}/admin-force-cancel`, input),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: orderDetailAdminQueryKey(orderId) }) },
  })
}

export type { HttpError }
