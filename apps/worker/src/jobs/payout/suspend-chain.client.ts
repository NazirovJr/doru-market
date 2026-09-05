/**
 * `requestSuspendChainForUnpaidInvoice` (EP-10, DTJ-252) — HTTP-клиент моста `apps/worker →
 * POST /api/v1/internal/pharmacy-chains/:id/suspend-for-unpaid-invoice` (`apps/api`, см. JSDoc
 * `SuspendChainForUnpaidInvoiceController`). Тот же стиль, что `system-order-cancel.client.ts`
 * (DTJ-253/254) — inline `fetch`, без DI-порта (простой stateless HTTP-вызов).
 *
 * `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN` — ПЕРЕИСПОЛЬЗУЮТСЯ (импорт, не копия) ИЗ
 * `escrow-timeouts/system-order-cancel.client.ts`: ТЕ ЖЕ ENV-переменные (`API_INTERNAL_URL`/
 * `INTERNAL_API_KEY`), уже «ОБЩИЕ для DTJ-253/DTJ-254» по её же JSDoc — этот тикет становится
 * ТРЕТЬИМ потребителем тех же токенов, не заводит четвёртую пару имён под тот же ENV.
 */
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from '../escrow-timeouts/system-order-cancel.client.js'

export { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN }

export interface SuspendChainClientDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

/** Тело запроса — ПУСТОЕ (см. JSDoc контроллера: `pharmacy_chains` не скоупится тенантом, только `:id` в пути). */
export async function requestSuspendChainForUnpaidInvoice(deps: SuspendChainClientDeps, chainId: string): Promise<void> {
  if (deps.internalApiKey === undefined) {
    // Программная ошибка конфигурации — бросает, не молчит (тот же принцип, что `requestSystemOrderCancel`).
    throw new Error('INTERNAL_API_KEY is not configured — cannot call internal suspend-for-unpaid-invoice endpoint')
  }
  const url = new URL(`/api/v1/internal/pharmacy-chains/${chainId}/suspend-for-unpaid-invoice`, deps.apiInternalUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-internal-api-key': deps.internalApiKey },
  })
  if (!response.ok) {
    throw new Error(`suspend-for-unpaid-invoice POST failed for chain=${chainId} (HTTP ${String(response.status)})`)
  }
}
