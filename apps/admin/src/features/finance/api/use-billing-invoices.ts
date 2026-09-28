// Билинг-инвойсы cash_courier-комиссии. Курсор локален странице (тот же приём, что use-finance-ledger.ts).
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { BillingInvoiceDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, httpPostJson, type HttpError, type QueryParams } from '@/shared/api/http-client'

const BILLING_INVOICES_PATH = '/api/v1/finance/billing-invoices'
const DEFAULT_LIMIT = 50

interface BillingInvoicesPage {
  readonly items: readonly BillingInvoiceDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export interface BillingInvoicesFilters {
  readonly chainId: string | undefined
  readonly invoiceType: string | undefined
  readonly status: string | undefined
}

function billingInvoicesQueryKey(filters: BillingInvoicesFilters, cursor: string | null): readonly unknown[] {
  return ['admin', 'finance', 'billing-invoices', filters, cursor] as const
}

export function useBillingInvoices(
  filters: BillingInvoicesFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<BillingInvoicesPage, HttpError> {
  return useQuery<BillingInvoicesPage, HttpError>({
    queryKey: billingInvoicesQueryKey(filters, cursor),
    queryFn: async () => {
      const params: QueryParams = {
        'filter[chainId]': filters.chainId,
        'filter[type]': filters.invoiceType,
        'filter[status]': filters.status,
        limit: String(limit),
        cursor: cursor ?? undefined,
      }
      const result = await httpGetJsonWithMeta<readonly BillingInvoiceDto[]>(BILLING_INVOICES_PATH, params)
      const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
      return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
    },
  })
}

export function useMarkInvoicePaid(): UseMutationResult<BillingInvoiceDto, HttpError, string> {
  const queryClient = useQueryClient()
  return useMutation<BillingInvoiceDto, HttpError, string>({
    mutationFn: (invoiceId) => httpPostJson<BillingInvoiceDto>(`${BILLING_INVOICES_PATH}/${invoiceId}/mark-paid`, {}),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'finance', 'billing-invoices'] }) },
  })
}

export interface LiftInvoiceBlockInput {
  readonly invoiceId: string
  readonly reason: string
}

export function useLiftInvoiceBlock(): UseMutationResult<unknown, HttpError, LiftInvoiceBlockInput> {
  const queryClient = useQueryClient()
  return useMutation<unknown, HttpError, LiftInvoiceBlockInput>({
    mutationFn: ({ invoiceId, reason }) => httpPostJson(`${BILLING_INVOICES_PATH}/${invoiceId}/lift-block`, { reason }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'finance', 'billing-invoices'] }) },
  })
}

export type { HttpError }
