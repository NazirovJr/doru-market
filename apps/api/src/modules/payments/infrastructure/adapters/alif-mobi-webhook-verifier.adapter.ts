/**
 * `AlifMobiWebhookVerifierAdapter` (EP-10, DTJ-239, `21-module-orders-payments-escrow.md`
 * §3.3/§5.2, SRS-PAY-006/019-021) — реализация `BankWebhookVerifierPort` (DTJ-237) для
 * `alif_mobi`. Структура идентична `MockBankWebhookVerifierAdapter` (DTJ-238) — полиморфизм по
 * `providerName` через `BankWebhookVerifierPort`, а не отдельная ветка `if` в обработчике
 * вебхука (SRS-PAY-005/DoD DTJ-238).
 *
 * // ASSUMPTION: контракт не подтверждён банком, research 03 §2.7 — заголовок `Signature` =
 * // `HMAC-SHA256(secret_key, raw_request_body)` в base64 (Alifpay, Узбекистан, ближайший
 * // публично документированный референс для Alif-группы; НЕ гарантированно идентично
 * // реальному контракту Alif Bank TJ). Точные имена полей тела вебхука — тоже ASSUMPTION
 * // (research 03 §2.6: статусы `DONE`/`PENDING`/`FAILED` документированы для `/hold`, здесь
 * // экстраполированы на webhook-событие по аналогии).
 *
 * HMAC-сравнение — ОБЩАЯ функция `verifyHmacSha256Signature` (`webhook-hmac-signature.util.ts`,
 * `02` C15) — та же, что использует `MockBankWebhookVerifierAdapter`/
 * `DcNextWebhookVerifierAdapter`, не копия алгоритма.
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Result } from '@dorutj/domain-kernel'
import { InvalidWebhookSignatureError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import type {
  BankWebhookVerifierPort,
  VerifiedWebhookPayload,
} from '@/modules/payments/application/ports/bank-webhook-verifier.port.js'
import { verifyHmacSha256Signature } from './webhook-hmac-signature.util.js'

/** ASSUMPTION (research 03 §2.7): Alifpay подписывает заголовком `Signature`, base64. */
export const ALIF_MOBI_SIGNATURE_HEADER = 'signature'

/** ASSUMPTION (research 03 §2.6, экстраполировано с `/hold`-статусов на webhook-событие). */
interface RawAlifMobiWebhookBody {
  readonly event_id: string
  readonly invoice_id: string
  readonly status: 'DONE' | 'FAILED' | 'REFUNDED' | 'REFUND_FAILED'
  readonly amount: string
  readonly created_at: string
}

const ALIF_STATUS_TO_TYPE: Readonly<Record<RawAlifMobiWebhookBody['status'], VerifiedWebhookPayload['type']>> = {
  DONE: 'payment_confirmed',
  FAILED: 'payment_failed',
  REFUNDED: 'refund_confirmed',
  REFUND_FAILED: 'refund_failed',
}

function isRawAlifMobiWebhookBody(value: unknown): value is RawAlifMobiWebhookBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.event_id === 'string' &&
    typeof body.invoice_id === 'string' &&
    typeof body.status === 'string' &&
    body.status in ALIF_STATUS_TO_TYPE &&
    typeof body.amount === 'string' &&
    typeof body.created_at === 'string'
  )
}

@Injectable()
export class AlifMobiWebhookVerifierAdapter implements BankWebhookVerifierPort {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public verify(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Result<VerifiedWebhookPayload, InvalidWebhookSignatureError> {
    const signature = headers[ALIF_MOBI_SIGNATURE_HEADER]
    if (!verifyHmacSha256Signature({ rawBody, providedSignature: signature, secret: this.config.alifMobiWebhookSecret, encoding: 'base64' })) {
      return { ok: false, error: new InvalidWebhookSignatureError({ provider: 'alif_mobi' }) }
    }
    return this.parsePayload(rawBody)
  }

  private parsePayload(rawBody: Buffer): Result<VerifiedWebhookPayload, InvalidWebhookSignatureError> {
    // SRS-PAY-020: JSON.parse ПОСЛЕ подтверждения подписи — см. JSDoc MockBankWebhookVerifierAdapter.
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'))
    if (!isRawAlifMobiWebhookBody(parsed)) {
      throw new Error('alif_mobi webhook body passed HMAC but has an unexpected shape — producer/consumer drift')
    }
    return {
      ok: true,
      value: {
        bankEventId: parsed.event_id,
        providerRef: parsed.invoice_id,
        type: ALIF_STATUS_TO_TYPE[parsed.status],
        amountDiram: BigInt(parsed.amount),
        occurredAt: new Date(parsed.created_at),
      },
    }
  }
}
