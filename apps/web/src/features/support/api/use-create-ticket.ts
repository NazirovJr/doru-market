/**
 * `useCreateTicket` (DTJ-284) — TanStack-мутация `createTicket`. Без `Idempotency-Key`
 * (в отличие от `useCreateOrder`, DTJ-235) — `POST /api/v1/support-tickets` не требует его
 * (DTJ-282 «Что сделать» п.1: нет платёжного эффекта). `onSuccess` инвалидирует список «моих
 * обращений» — свежесозданный тикет обязан появиться в `MyTicketsList` без ручного рефреша.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { SupportTicketDto } from '@dorutj/contracts'
import type { HttpError } from '@/shared/api/http-client'
import { createTicket, type CreateTicketInput } from './create-ticket.api'
import { MY_TICKETS_QUERY_KEY } from './use-my-tickets'

export function useCreateTicket(): UseMutationResult<SupportTicketDto, HttpError, CreateTicketInput> {
  const queryClient = useQueryClient()
  return useMutation<SupportTicketDto, HttpError, CreateTicketInput>({
    mutationFn: createTicket,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_TICKETS_QUERY_KEY })
    },
  })
}
