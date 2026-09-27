// Мост apps/worker → POST /api/v1/internal/pharmacy-api-keys/:id/revoke-expired, приём как у system-order-cancel.client.ts.
export const API_INTERNAL_URL_TOKEN = Symbol.for('@dorutj/worker/api-internal-url')
export const INTERNAL_API_KEY_TOKEN = Symbol.for('@dorutj/worker/internal-api-key')

export interface RevokeExpiredRotatedKeyDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

export interface RevokeExpiredRotatedKeyResult {
  readonly revoked: boolean
}

interface SuccessEnvelopeShape {
  readonly data: RevokeExpiredRotatedKeyResult
}

function isSuccessEnvelopeShape(value: unknown): value is SuccessEnvelopeShape {
  return typeof value === 'object' && value !== null && 'data' in value
}

export async function requestRevokeExpiredRotatedKey(
  deps: RevokeExpiredRotatedKeyDeps,
  keyId: string,
): Promise<RevokeExpiredRotatedKeyResult> {
  if (deps.internalApiKey === undefined) {
    throw new Error('INTERNAL_API_KEY is not configured — cannot call internal revoke-expired endpoint')
  }
  const url = new URL(`/api/v1/internal/pharmacy-api-keys/${keyId}/revoke-expired`, deps.apiInternalUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-api-key': deps.internalApiKey },
  })
  if (!response.ok) {
    throw new Error(`revoke-expired POST failed for key=${keyId} (HTTP ${String(response.status)})`)
  }
  const body: unknown = await response.json()
  if (!isSuccessEnvelopeShape(body)) {
    throw new Error(`revoke-expired POST for key=${keyId} returned an unexpected response shape`)
  }
  return body.data
}
