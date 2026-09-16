import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { OrderReturnDto } from '@dorutj/contracts'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { INCOMING_RETURNS_QUERY_KEY } from './use-incoming-returns'

/**
 * `use-confirm-return.ts` (DTJ-277, EP-11) — `POST /api/v1/order-returns/:id/confirm`
 * (`ConfirmReturnReceivedUseCase`, DTJ-273/275). Ответ — `OrderReturnDto` с уже ВЫЧИСЛЕННЫМ
 * сервером `disposition` (`restock`/`destroy`/`pending_inspection`) — клиент ТОЛЬКО отображает
 * (DTJ-277 «Что сделать» п.4, `SRS-DOM-053/054` считает домен, не UI).
 *
 * `retry: 0` — тот же приём, что `use-verify-otp.ts`: подтверждение приёмки не идемпотентно по
 * повтору по умолчанию на транспортном уровне ретрая TanStack Query (двойная отправка — забота
 * UI, кнопка блокируется на `isPending`, см. `ReturnChecklistForm.tsx`).
 *
 * `checklist` — тело 1:1 с серверной `ConfirmReceivedChecklist` (`ReturnChecklistForm.model.ts`
 * строит это значение через `buildConfirmChecklistPayload`); тип объявлен здесь локально (не
 * импортируется из `ui/`), как `VerifyOtpRequest`/`RequestOtpRequest` в `features/auth/api/*` —
 * `api/` не зависит от `ui/` той же фичи, структурная типизация делает импорт не нужным.
 */
export interface ConfirmReturnChecklist {
  readonly packagingIntact: boolean
  readonly notes?: string
}

export interface ConfirmReturnInput {
  readonly returnId: string
  readonly checklist: ConfirmReturnChecklist
}

export function useConfirmReturn(): UseMutationResult<OrderReturnDto, HttpError, ConfirmReturnInput> {
  const queryClient = useQueryClient()
  return useMutation<OrderReturnDto, HttpError, ConfirmReturnInput>({
    mutationKey: ['returns', 'confirm'],
    retry: 0,
    mutationFn: async ({ returnId, checklist }: ConfirmReturnInput): Promise<OrderReturnDto> => {
      return httpPostJson<OrderReturnDto>(`/api/v1/order-returns/${returnId}/confirm`, { checklist })
    },
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: INCOMING_RETURNS_QUERY_KEY })
    },
  })
}
