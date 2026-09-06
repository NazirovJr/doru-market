/**
 * `useChangeTicketStatus` (DTJ-283) — мутация `POST /api/v1/support-tickets/:id/status` (DTJ-282).
 * `StatusTransition` — 1:1 с `ChangeStatusSchema` (`apps/api/.../dto/change-status.dto.ts`):
 * `'open'` исключён, ни одно ребро состояний в него не ведёт.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { SupportTicketDto, SupportTicketStatus } from '@dorutj/contracts'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { supportTicketDetailQueryKey } from './use-support-ticket-detail'

export type StatusTransition = Extract<SupportTicketStatus, 'in_progress' | 'resolved' | 'closed'>

const SUPPORT_TICKETS_LIST_QUERY_KEY = ['admin', 'support-tickets', 'list'] as const

export function useChangeTicketStatus(ticketId: string): UseMutationResult<SupportTicketDto, HttpError, StatusTransition> {
  const queryClient = useQueryClient()
  return useMutation<SupportTicketDto, HttpError, StatusTransition>({
    mutationFn: (status) => httpPostJson<SupportTicketDto>(`/api/v1/support-tickets/${ticketId}/status`, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData(supportTicketDetailQueryKey(ticketId), updated)
      void queryClient.invalidateQueries({ queryKey: SUPPORT_TICKETS_LIST_QUERY_KEY })
    },
  })
}
