import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { OrderReturnDto } from '@dorutj/contracts'
import { httpPostJson, type HttpError } from '@/shared/api/http-client'
import { INCOMING_RETURNS_QUERY_KEY } from './use-incoming-returns'

/**
 * `use-reject-return.ts` (DTJ-277, EP-11) — `POST /api/v1/order-returns/:id/reject`
 * (`RejectReturnUseCase`, DTJ-273/275). Отдельный CTA от `ReturnChecklistForm` (DTJ-277 «Что
 * сделать» п.3) — отказ не требует чек-листа упаковки, только текстовую причину
 * (`isRejectReasonValid`, `ReturnChecklistForm.model.ts`, схемная валидация ДО отправки).
 */
export interface RejectReturnInput {
  readonly returnId: string
  readonly reason: string
}

export function useRejectReturn(): UseMutationResult<OrderReturnDto, HttpError, RejectReturnInput> {
  const queryClient = useQueryClient()
  return useMutation<OrderReturnDto, HttpError, RejectReturnInput>({
    mutationKey: ['returns', 'reject'],
    retry: 0,
    mutationFn: async ({ returnId, reason }: RejectReturnInput): Promise<OrderReturnDto> => {
      return httpPostJson<OrderReturnDto>(`/api/v1/order-returns/${returnId}/reject`, { reason })
    },
    onSuccess: (): void => {
      void queryClient.invalidateQueries({ queryKey: INCOMING_RETURNS_QUERY_KEY })
    },
  })
}
