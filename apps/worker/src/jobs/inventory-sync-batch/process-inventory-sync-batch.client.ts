// HTTP-мост apps/worker → POST /api/v1/internal/inventory/sync-batches/:id/process; те же
// API_INTERNAL_URL_TOKEN/INTERNAL_API_KEY_TOKEN, что system-order-cancel.client.ts (переиспользованы, не скопированы).
import { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN } from '../escrow-timeouts/system-order-cancel.client.js'

export { API_INTERNAL_URL_TOKEN, INTERNAL_API_KEY_TOKEN }

export interface ProcessInventorySyncBatchClientDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

export async function requestProcessInventorySyncBatch(
  deps: ProcessInventorySyncBatchClientDeps,
  batchId: string,
): Promise<void> {
  if (deps.internalApiKey === undefined) {
    throw new Error('INTERNAL_API_KEY is not configured — cannot call internal sync-batches/process endpoint')
  }
  const url = new URL(`/api/v1/internal/inventory/sync-batches/${batchId}/process`, deps.apiInternalUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-internal-api-key': deps.internalApiKey },
  })
  if (!response.ok) {
    throw new Error(`sync-batches/process POST failed for batch=${batchId} (HTTP ${String(response.status)})`)
  }
}
