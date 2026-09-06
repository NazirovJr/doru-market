/**
 * `useRespondTicket` (DTJ-283) — мутация `POST /api/v1/support-tickets/:id/messages` (DTJ-282).
 * `onSuccess` — АС2 тикета: ответ сервера уже несёт обновлённый `firstRespondedAt`/полную ленту
 * сообщений (`SupportTicketDetailView`, DTJ-282) — `setQueryData` обновляет кэш детали НЕМЕДЛЕННО
 * (без второго `GET`), `invalidateQueries` на список — фоновый рефетч (SLA-бейдж в очереди тоже
 * должен переключиться на «отвечено»).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { SupportTicketDto } from '@dorutj/contracts'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { supportTicketDetailQueryKey } from './use-support-ticket-detail'

const SUPPORT_TICKETS_LIST_QUERY_KEY = ['admin', 'support-tickets', 'list'] as const

export function useRespondTicket(ticketId: string): UseMutationResult<SupportTicketDto, HttpError, string> {
  const queryClient = useQueryClient()
  return useMutation<SupportTicketDto, HttpError, string>({
    mutationFn: (body) => httpPostJson<SupportTicketDto>(`/api/v1/support-tickets/${ticketId}/messages`, { body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(supportTicketDetailQueryKey(ticketId), updated)
      void queryClient.invalidateQueries({ queryKey: SUPPORT_TICKETS_LIST_QUERY_KEY })
    },
  })
}
