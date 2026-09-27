import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { OrderReturnDto } from '@dorutj/contracts'
import { httpRequestJson } from '@/shared/api/http-client'

const INCOMING_RETURN_STATUSES = ['return_in_transit', 'return_rejected'] as const

export const INCOMING_RETURNS_QUERY_KEY = ['returns', 'incoming'] as const

export const INCOMING_RETURNS_PATH = `/api/v1/order-returns?filter[status][in]=${INCOMING_RETURN_STATUSES.join(',')}`

interface IncomingReturnsResponse {
  readonly items: readonly OrderReturnDto[]
}

export interface IncomingReturnsResult {
  readonly inTransit: readonly OrderReturnDto[]
  readonly rejected: readonly OrderReturnDto[]
}

function groupByStatus(items: readonly OrderReturnDto[]): IncomingReturnsResult {
  return {
    inTransit: items.filter((item) => item.status === 'return_in_transit'),
    rejected: items.filter((item) => item.status === 'return_rejected'),
  }
}

export function useIncomingReturns(): UseQueryResult<IncomingReturnsResult> {
  return useQuery({
    queryKey: INCOMING_RETURNS_QUERY_KEY,
    queryFn: async (): Promise<IncomingReturnsResult> => {
      const response = await httpRequestJson<IncomingReturnsResponse>(INCOMING_RETURNS_PATH)
      return groupByStatus(response.items)
    },
  })
}
