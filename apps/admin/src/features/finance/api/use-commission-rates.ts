// DTJ-358 — тот же приём, что use-finance-ledger.ts (курсор локален странице, filter[...] bracket-синтаксис).
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { CommissionRateDto, UpsertCommissionRateDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta, httpPatchJson, httpPostJson, type HttpError, type QueryParams } from '@/shared/api/http-client'

const COMMISSION_RATES_PATH = '/api/v1/finance/commission-rates'
const DEFAULT_LIMIT = 50

export interface CommissionRatesFilters {
  readonly tenantId: string | undefined
  readonly chainId: string | undefined
  readonly category: string | undefined
}

interface CommissionRatesPage {
  readonly items: readonly CommissionRateDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

async function fetchCommissionRatesPage(filters: CommissionRatesFilters, cursor: string | null, limit: number): Promise<CommissionRatesPage> {
  const params: QueryParams = {
    'filter[tenantId]': filters.tenantId,
    'filter[chainId]': filters.chainId,
    'filter[category]': filters.category,
    limit: String(limit),
    cursor: cursor ?? undefined,
  }
  const result = await httpGetJsonWithMeta<readonly CommissionRateDto[]>(COMMISSION_RATES_PATH, params)
  const pagination = result.meta?.pagination as { nextCursor: string | null; hasMore: boolean } | undefined
  return { items: result.data, nextCursor: pagination?.nextCursor ?? null, hasMore: pagination?.hasMore ?? false }
}

export function useCommissionRates(
  filters: CommissionRatesFilters,
  cursor: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<CommissionRatesPage, HttpError> {
  return useQuery<CommissionRatesPage, HttpError>({
    queryKey: ['admin', 'finance', 'commission-rates', filters, cursor] as const,
    queryFn: () => fetchCommissionRatesPage(filters, cursor, limit),
  })
}

const COMMISSION_RATES_QUERY_KEY_PREFIX = ['admin', 'finance', 'commission-rates'] as const

export function useUpsertCommissionRate(): {
  readonly mutate: (input: { readonly id?: string; readonly body: UpsertCommissionRateDto }) => void
  readonly isPending: boolean
  readonly error: HttpError | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation<CommissionRateDto, HttpError, { readonly id?: string; readonly body: UpsertCommissionRateDto }>({
    mutationFn: ({ id, body }) =>
      id === undefined ? httpPostJson(COMMISSION_RATES_PATH, body) : httpPatchJson(`${COMMISSION_RATES_PATH}/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMMISSION_RATES_QUERY_KEY_PREFIX })
    },
  })
  return { mutate: mutation.mutate, isPending: mutation.isPending, error: mutation.error }
}
