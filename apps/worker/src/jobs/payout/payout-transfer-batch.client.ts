/**
 * `requestPayoutTransferBatch` (EP-10, DTJ-250) — HTTP-клиент моста
 * `apps/worker → POST /api/v1/internal/payouts/transfer-batch` (`apps/api`, см. JSDoc
 * `transfer-payout-batch.use-case.ts` «МОСТ МЕЖДУ ПРОЦЕССАМИ» для полного обоснования: этот
 * запрос — ЕДИНСТВЕННЫЙ способ, которым `apps/worker` физически может достичь
 * `BankPayoutTransferPort`, живущего в DI-графе `apps/api`).
 *
 * Токены соединения (`API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN`) — ИМПОРТИРОВАНЫ из
 * `../escrow-timeouts/system-order-cancel.client.ts` (DTJ-253/254), НЕ заведены заново: те токены
 * УЖЕ явно задуманы как ОБЩИЕ («ОБЩИЕ токены с DTJ-254», её JSDoc) поверх ТЕХ ЖЕ ENV-переменных
 * (`API_INTERNAL_URL`/`INTERNAL_API_KEY`) — этот файл использует ТУ ЖЕ пару, `payout-execution.
 * module.ts` независимо биндит их своей `useFactory` (тот же приём, что все job-модули этой
 * семьи). Стиль — inline `fetch` без DI-порта, тот же приём, что `system-order-cancel.client.ts`.
 */
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from '../escrow-timeouts/system-order-cancel.client.js'

export { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN }

export interface PayoutTransferBatchDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

export interface PayoutTransferBatchRequestItem {
  readonly payoutScheduleId: string
  readonly pharmacyMerchantRef: string
  /** `bigint` сериализуется строкой на проводе (JSON не несёт нативный bigint). */
  readonly amountDiram: string
}

export interface PayoutTransferBatchResponse {
  readonly batchRef: string | null
  readonly confirmedPayoutScheduleIds: readonly string[]
}

interface SuccessEnvelopeShape {
  readonly data: PayoutTransferBatchResponse
}

function isSuccessEnvelopeShape(value: unknown): value is SuccessEnvelopeShape {
  return typeof value === 'object' && value !== null && 'data' in value
}

export async function requestPayoutTransferBatch(
  deps: PayoutTransferBatchDeps,
  payouts: readonly PayoutTransferBatchRequestItem[],
): Promise<PayoutTransferBatchResponse> {
  if (deps.internalApiKey === undefined) {
    // Программная ошибка конфигурации — бросает, не молчит (тот же принцип, что
    // `requestSystemOrderCancel` про `INTERNAL_API_KEY`).
    throw new Error('INTERNAL_API_KEY is not configured — cannot call internal payouts/transfer-batch endpoint')
  }
  const url = new URL('/api/v1/internal/payouts/transfer-batch', deps.apiInternalUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-api-key': deps.internalApiKey },
    body: JSON.stringify({ payouts }),
  })
  if (!response.ok) {
    throw new Error(`payouts/transfer-batch POST failed (HTTP ${String(response.status)})`)
  }
  const body: unknown = await response.json()
  if (!isSuccessEnvelopeShape(body)) {
    throw new Error('payouts/transfer-batch POST returned an unexpected response shape')
  }
  return body.data
}
