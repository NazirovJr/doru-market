import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import type { CompletePickingRequestDto, HandoverOtpDto } from '@dorutj/contracts'
import { httpRequestJson, type HttpError } from '@/shared/api/http-client'

/** 1:1 с `apps/api` `CompletePickingResponseData` (`pharmacy-terminal.mapper.ts`, DTJ-305) — не импортируется напрямую (backend/frontend изоляция, `fe-shared-is-lowest`/depcruise). */
export interface CompletePickingResponseData {
  readonly orderId: string
  readonly status: 'picked_up'
  readonly handoverOtp: HandoverOtpDto
}

function completePicking(orderId: string, body: CompletePickingRequestDto, idempotencyKey: string): Promise<CompletePickingResponseData> {
  return httpRequestJson<CompletePickingResponseData>(`/api/v1/orders/${orderId}/complete-picking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
}

/** `POST /orders/:id/complete-picking` (SRS-PHT-024/025, DTJ-305) — `sealConfirmed` из явного чекбокса, никогда не подразумевается `true`. */
export function useCompletePicking(orderId: string): UseMutationResult<CompletePickingResponseData, HttpError, boolean> {
  return useMutation<CompletePickingResponseData, HttpError, boolean>({
    mutationKey: ['order-fulfillment', 'complete-picking', orderId],
    retry: 0,
    mutationFn: (sealConfirmed) => completePicking(orderId, { sealConfirmed }, crypto.randomUUID()),
  })
}
