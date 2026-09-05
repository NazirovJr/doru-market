/**
 * `requestSystemOrderCancel` (EP-10, DTJ-253/254) — общий HTTP-клиент моста
 * `apps/worker → POST /api/v1/internal/orders/:id/system-cancel` (`apps/api`, см. JSDoc
 * `system-cancel-order.use-case.ts` «МОСТ МЕЖДУ ПРОЦЕССАМИ»). ОБЩАЯ функция для ДВУХ реальных
 * потребителей (`UnpaidOrderTimeoutJob`/DTJ-253, `PickupSlaTimeoutJob`/DTJ-254) — не
 * копипаста дважды одного и того же `fetch`-вызова (`02` C15, тот же довод, что
 * `verifyHmacSha256Signature`, DTJ-239: два РЕАЛЬНЫХ конкретных потребителя, не абстракция
 * «на будущее»). Стиль — inline `fetch` без DI-порта, тот же приём, что `MockBankAutoPayJob`
 * (DTJ-238): простой stateless HTTP-вызов, не подменяемая в проде зависимость.
 */
/** DI-токены ОБЩИЕ для DTJ-253/DTJ-254 (см. JSDoc файла) — оба job-модуля биндят их своим
 * `useFactory` поверх ТЕХ ЖЕ `API_INTERNAL_URL`/`INTERNAL_API_KEY` (ENV), не создавая вторую
 * пару имён. */
export const API_INTERNAL_URL_TOKEN = Symbol.for('@dorutj/worker/api-internal-url')
export const INTERNAL_API_KEY_TOKEN = Symbol.for('@dorutj/worker/internal-api-key')

export interface SystemOrderCancelDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

export type SystemCancelExpectedStatus = 'pending_payment' | 'paid_escrow' | 'confirmed'
export type SystemCancelReason = 'payment_timeout' | 'pickup_sla_timeout'

export interface SystemOrderCancelInput {
  readonly orderId: string
  readonly tenantId: string
  readonly expectedFromStatus: SystemCancelExpectedStatus
  readonly reason: SystemCancelReason
}

export interface SystemOrderCancelResult {
  readonly orderId: string
  readonly status: 'cancelled' | 'skipped'
  readonly refundIssued: boolean
}

interface SuccessEnvelopeShape {
  readonly data: SystemOrderCancelResult
}

function isSuccessEnvelopeShape(value: unknown): value is SuccessEnvelopeShape {
  return typeof value === 'object' && value !== null && 'data' in value
}

export async function requestSystemOrderCancel(
  deps: SystemOrderCancelDeps,
  input: SystemOrderCancelInput,
): Promise<SystemOrderCancelResult> {
  if (deps.internalApiKey === undefined) {
    // Программная ошибка конфигурации — бросает, не молчит (тот же принцип, что
    // `MockBankAutoPayJob` про `MOCK_BANK_WEBHOOK_SECRET`, D-EP09-16 для заглушек денежных операций).
    throw new Error('INTERNAL_API_KEY is not configured — cannot call internal system-cancel endpoint')
  }
  const url = new URL(`/api/v1/internal/orders/${input.orderId}/system-cancel`, deps.apiInternalUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-api-key': deps.internalApiKey },
    body: JSON.stringify({
      tenantId: input.tenantId,
      expectedFromStatus: input.expectedFromStatus,
      reason: input.reason,
    }),
  })
  if (!response.ok) {
    throw new Error(`system-cancel POST failed for order=${input.orderId} (HTTP ${String(response.status)})`)
  }
  const body: unknown = await response.json()
  if (!isSuccessEnvelopeShape(body)) {
    throw new Error(`system-cancel POST for order=${input.orderId} returned an unexpected response shape`)
  }
  return body.data
}
