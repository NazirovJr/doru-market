// DTJ-357 — курсор локален странице (тот же приём, что use-audit-log.ts), фильтры — filter[...] (bracket, см. finance-ledger.controller.ts).
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { FinanceEscrowLedgerEntryDto, FinancePayoutScheduleEntryDto, FinanceReconciliationAlertDto } from '@dorutj/contracts'
import { httpGetJson, httpGetJsonWithMeta, type HttpError, type QueryParams } from '@/shared/api/http-client'

const FINANCE_PATH = '/api/v1/finance'
const DEFAULT_LIMIT = 50

interface FinancePageResult<T> {
  readonly items: readonly T[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

interface FetchFinancePageInput {
  readonly path: string
  readonly params: QueryParams
  readonly cursor: string | null
  readonly limit: number
}

async function fetchFinancePage<T>(input: FetchFinancePageInput): Promise<FinancePageResult<T>> {
  const result = await httpGetJsonWithMeta<readonly T[]>(input.path, { ...input.params, limit: String(input.limit), cursor: input.cursor ?? undefined })
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

/** Без пагинации — леджер одного заказа ограничен по размеру (DTJ-357 review). */
export function useEscrowLedger(orderId: string | undefined): UseQueryResult<readonly FinanceEscrowLedgerEntryDto[], HttpError> {
  return useQuery<readonly FinanceEscrowLedgerEntryDto[], HttpError>({
    queryKey: ['admin', 'finance', 'escrow-ledger', orderId] as const,
    queryFn: () => httpGetJson<readonly FinanceEscrowLedgerEntryDto[]>(`${FINANCE_PATH}/escrow-ledger`, { 'filter[orderId]': orderId }),
    enabled: orderId !== undefined && orderId.length > 0,
  })
}

export interface PayoutScheduleFilters {
  readonly status: string | undefined
  readonly pharmacyId: string | undefined
}

export function usePayoutSchedule(
  filters: PayoutScheduleFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<FinancePageResult<FinancePayoutScheduleEntryDto>, HttpError> {
  return useQuery<FinancePageResult<FinancePayoutScheduleEntryDto>, HttpError>({
    queryKey: ['admin', 'finance', 'payout-schedule', filters, cursor] as const,
    queryFn: () =>
      fetchFinancePage({
        path: `${FINANCE_PATH}/payout-schedule`,
        params: { 'filter[status]': filters.status, 'filter[pharmacyId]': filters.pharmacyId },
        cursor,
        limit,
      }),
  })
}

export function useReconciliationAlerts(
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<FinancePageResult<FinanceReconciliationAlertDto>, HttpError> {
  return useQuery<FinancePageResult<FinanceReconciliationAlertDto>, HttpError>({
    queryKey: ['admin', 'finance', 'reconciliation-alerts', cursor] as const,
    queryFn: () => fetchFinancePage({ path: `${FINANCE_PATH}/reconciliation-alerts`, params: {}, cursor, limit }),
  })
}

export type { HttpError }
