/**
 * `requestEscalateSupportTicketPriority` (EP-14, DTJ-280) — HTTP-мост
 * `apps/worker → POST /api/v1/internal/support-tickets/:id/escalate-priority` (`apps/api`, см.
 * JSDoc `escalate-ticket-priority.controller.ts` «МОСТ МЕЖДУ ПРОЦЕССАМИ»). Стиль — inline `fetch`
 * без DI-порта, тот же приём, что `system-order-cancel.client.ts` (DTJ-253/254): простой
 * stateless HTTP-вызов, не подменяемая в проде зависимость.
 *
 * Переиспользует ТЕ ЖЕ DI-токены `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN`
 * (`system-order-cancel.client.ts`) — тот же секрет/URL инфраструктуры internal-моста для ВСЕХ
 * джоб apps/worker, не вторая пара имён (её же JSDoc: «оба job-модуля биндят их своим useFactory
 * поверх ТЕХ ЖЕ ENV»).
 */
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN, type SystemOrderCancelDeps } from '../escrow-timeouts/system-order-cancel.client.js'

export { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN }

export type EscalateSupportTicketDeps = SystemOrderCancelDeps

export interface EscalateSupportTicketResult {
  readonly ticketId: string
  readonly priority: number
}

interface SuccessEnvelopeShape {
  readonly data: EscalateSupportTicketResult
}

function isSuccessEnvelopeShape(value: unknown): value is SuccessEnvelopeShape {
  return typeof value === 'object' && value !== null && 'data' in value
}

export async function requestEscalateSupportTicketPriority(
  deps: EscalateSupportTicketDeps,
  ticketId: string,
): Promise<EscalateSupportTicketResult> {
  if (deps.internalApiKey === undefined) {
    // Программная ошибка конфигурации — бросает, не молчит (C12, тот же приём, что
    // `requestSystemOrderCancel`).
    throw new Error('INTERNAL_API_KEY is not configured — cannot call internal escalate-priority endpoint')
  }
  const url = new URL(`/api/v1/internal/support-tickets/${ticketId}/escalate-priority`, deps.apiInternalUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-api-key': deps.internalApiKey },
  })
  if (!response.ok) {
    throw new Error(`escalate-priority POST failed for ticket=${ticketId} (HTTP ${String(response.status)})`)
  }
  const body: unknown = await response.json()
  if (!isSuccessEnvelopeShape(body)) {
    throw new Error(`escalate-priority POST for ticket=${ticketId} returned an unexpected response shape`)
  }
  return body.data
}
