import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import type { HandoverOtpDto } from '@dorutj/contracts'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'

export function handoverOtpQueryKey(orderId: string): readonly [string, string, string] {
  return ['order-fulfillment', 'handover-otp', orderId] as const
}

function fetchHandoverOtp(orderId: string): Promise<HandoverOtpDto> {
  return httpRequestJson<HandoverOtpDto>(`/api/v1/orders/${orderId}/handover-otp`)
}

/** `GET /orders/:id/handover-otp` (SRS-PHT-028) — `initialData` пропускает лишний запрос, когда код уже пришёл в ответе `complete-picking`. */
export function useHandoverOtp(orderId: string, initialData?: HandoverOtpDto): UseQueryResult<HandoverOtpDto, HttpError> {
  return useQuery<HandoverOtpDto, HttpError>({
    queryKey: handoverOtpQueryKey(orderId),
    queryFn: () => fetchHandoverOtp(orderId),
    ...(initialData !== undefined ? { initialData } : {}),
  })
}

function regenerateHandoverOtp(orderId: string, idempotencyKey: string): Promise<HandoverOtpDto> {
  return httpRequestJson<HandoverOtpDto>(`/api/v1/orders/${orderId}/handover-otp/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({}),
  })
}

export function useRegenerateHandoverOtp(orderId: string): UseMutationResult<HandoverOtpDto, HttpError, void> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['order-fulfillment', 'regenerate-handover-otp', orderId],
    retry: 0,
    mutationFn: () => regenerateHandoverOtp(orderId, crypto.randomUUID()),
    // Замена целиком (не merge) — старый код НЕ должен остаться на экране рядом с новым (критерий приёмки 3).
    onSuccess: (otp) => { queryClient.setQueryData<HandoverOtpDto>(handoverOtpQueryKey(orderId), otp) },
  })
}
