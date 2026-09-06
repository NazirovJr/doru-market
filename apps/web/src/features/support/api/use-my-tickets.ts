/**
 * `useMyTickets` (DTJ-284) — TanStack Query список «моих обращений» (`MyTicketsList.tsx`).
 * `MY_TICKETS_QUERY_KEY` экспортирован — `useCreateTicket` инвалидирует ИМЕННО этот ключ после
 * успешного создания тикета (единая точка истины для ключа, не дублировать строковый литерал).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { SupportTicketDto } from '@dorutj/contracts'
import type { HttpError } from '@/shared/api/http-client'
import { fetchMyTickets } from './my-tickets.api'

export const MY_TICKETS_QUERY_KEY = ['support', 'my-tickets'] as const

export interface UseMyTicketsOptions {
  /** `false` — не отправлять запрос (гость без `accessToken`, см. `MyTicketsList.tsx`). По умолчанию `true`. */
  readonly enabled?: boolean
}

export function useMyTickets(options: UseMyTicketsOptions = {}): UseQueryResult<readonly SupportTicketDto[], HttpError> {
  return useQuery<readonly SupportTicketDto[], HttpError>({
    queryKey: MY_TICKETS_QUERY_KEY,
    queryFn: fetchMyTickets,
    enabled: options.enabled ?? true,
  })
}
