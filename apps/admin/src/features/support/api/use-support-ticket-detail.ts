/**
 * `useSupportTicketDetail` (DTJ-283) — TanStack Query деталь одного тикета
 * (`GET /api/v1/support-tickets/:id`, DTJ-282) — метаданные + полная лента `messages`
 * (в отличие от `useSupportTickets`, где `messages` всегда `[]`).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { SupportTicketDto } from '@dorutj/contracts'
import { httpGetJson, type HttpError } from '@/shared/api/http-client'

export function supportTicketDetailQueryKey(ticketId: string): readonly unknown[] {
  return ['admin', 'support-tickets', 'detail', ticketId]
}

export function useSupportTicketDetail(ticketId: string): UseQueryResult<SupportTicketDto, HttpError> {
  return useQuery<SupportTicketDto, HttpError>({
    queryKey: supportTicketDetailQueryKey(ticketId),
    queryFn: () => httpGetJson<SupportTicketDto>(`/api/v1/support-tickets/${ticketId}`),
  })
}
