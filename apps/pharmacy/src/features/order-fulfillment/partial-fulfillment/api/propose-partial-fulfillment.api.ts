import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import type { PartialFulfillmentRequestDto } from '@dorutj/contracts'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'

/** `POST /orders/:id/propose-partial-fulfillment` (SRS-PHT-019/020, DTJ-304) — тело пустое, `Idempotency-Key` обязателен (`@Idempotent()`). */
function proposePartialFulfillment(orderId: string, idempotencyKey: string): Promise<PartialFulfillmentRequestDto> {
  return httpRequestJson<PartialFulfillmentRequestDto>(`/api/v1/orders/${orderId}/propose-partial-fulfillment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({}),
  })
}

export function useProposePartialFulfillment(orderId: string): UseMutationResult<PartialFulfillmentRequestDto, HttpError, void> {
  return useMutation({
    mutationKey: ['order-fulfillment', 'propose-partial-fulfillment', orderId],
    retry: 0,
    mutationFn: () => proposePartialFulfillment(orderId, crypto.randomUUID()),
  })
}
