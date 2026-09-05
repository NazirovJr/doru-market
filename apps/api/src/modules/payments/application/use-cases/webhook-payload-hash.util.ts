/**
 * `hashWebhookPayload` (EP-10, DTJ-243) — детерминированный хэш ВЕРИФИЦИРОВАННОГО (уже
 * распарсенного) payload'а для `audit_log.metadata.rawPayloadHash` (SRS-PAY-028) —
 * корреляционный идентификатор попытки, не криптографическая проверка целостности (та уже
 * выполнена HMAC в `verify()` ДО этого шага). Хэш ПОЛЕЙ payload'а, не сырых байт тела: на этом
 * шаге сырые байты уже не нужны вызывающему коду (`processVerifiedPayload` получает только
 * распарсенный `VerifiedWebhookPayload`), а детерминированный набор полей (`bankEventId`/
 * `providerRef`/`type`/`amountDiram`/`occurredAt`) даёт ту же корреляционную способность.
 */
import { createHash } from 'node:crypto'
import type { VerifiedWebhookPayload } from '@/modules/payments/application/ports/bank-webhook-verifier.port.js'

export function hashWebhookPayload(payload: VerifiedWebhookPayload): string {
  const canonical = JSON.stringify({
    bankEventId: payload.bankEventId,
    providerRef: payload.providerRef,
    type: payload.type,
    amountDiram: payload.amountDiram.toString(),
    occurredAt: payload.occurredAt.toISOString(),
  })
  return createHash('sha256').update(canonical).digest('hex')
}
