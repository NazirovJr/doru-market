/**
 * `verifyHmacSha256Signature` (EP-10, DTJ-239 «Что сделать» п.3, `02` C15) — ЕДИНСТВЕННАЯ
 * реализация HMAC-SHA256-сравнения подписи вебхука банка, общая для ВСЕХ трёх верификаторов
 * (`MockBankWebhookVerifierAdapter`, DTJ-238; `AlifMobiWebhookVerifierAdapter`/
 * `DcNextWebhookVerifierAdapter`, этот тикет) — DoD DTJ-239 требует явно: «HMAC-сравнение —
 * одна общая функция для всех трёх верификаторов», не копипаста алгоритма трижды.
 *
 * Извлечена из `MockBankWebhookVerifierAdapter.hasValidSignature` (DTJ-238) БЕЗ изменения
 * поведения — `mock-bank-webhook-verifier.adapter.spec.ts` проходит без правок, доказывая
 * поведенческую эквивалентность.
 *
 * `encoding` — банк-специфичный формат подписи в заголовке (SRS-PAY-006 ASSUMPTION): Alifpay
 * (research 03 §2.7) документирует `base64`, мок-адаптер (DTJ-238) использует `hex`
 * (произвольный выбор ДО появления реального контракта) — параметризовано, а не жёстко зашито,
 * т.к. второй реальный формат (Alifpay base64) появился уже на этом тикете, не гипотетически.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type WebhookSignatureEncoding = 'hex' | 'base64'

/** Объект-параметр (C5, `max-params` ≤3) — четыре логически неразделимых поля одной подписи. */
export interface VerifyHmacSha256SignatureInput {
  readonly rawBody: Buffer
  readonly providedSignature: string | undefined
  readonly secret: string | undefined
  readonly encoding: WebhookSignatureEncoding
}

export function verifyHmacSha256Signature(input: VerifyHmacSha256SignatureInput): boolean {
  const { rawBody, providedSignature, secret, encoding } = input
  if (secret === undefined || providedSignature === undefined) {
    return false
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(providedSignature, encoding)
  } catch {
    return false
  }
  // Сравниваем ДЛИНЫ БУФЕРОВ (байты), не длину закодированной строки — timingSafeEqual
  // требует буферов одинаковой длины (тот же приём, что DrizzlePharmacyApiKeyVerificationAdapter).
  if (provided.length !== expected.length) {
    return false
  }
  return timingSafeEqual(provided, expected)
}
