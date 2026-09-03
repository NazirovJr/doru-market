/**
 * `DcNextWebhookVerifierAdapter` (EP-10, DTJ-239, `21-module-orders-payments-escrow.md`
 * §3.3/§5.2, SRS-PAY-006/019-021) — реализация `BankWebhookVerifierPort` (DTJ-237) для
 * `dc_next`. Структура идентична `AlifMobiWebhookVerifierAdapter`/`MockBankWebhookVerifierAdapter`
 * (полиморфизм по `providerName`, SRS-PAY-005/DoD DTJ-238).
 *
 * // ASSUMPTION: контракт не подтверждён банком, research 03 §4 — DC Next (Dushanbe City Bank)
 * // не публикует НИКАКОЙ технической API-документации (research 03: «UNVERIFIED: любая
 * // техническая API-документация для мерчантов»). Контракт этого адаптера смоделирован ПО
 * // АНАЛОГИИ с Alifpay (§2.7 того же документа) — тот же ближайший референс, что для
 * // `alif_mobi` (SRS-PAY-006), НЕ гарантированно идентично реальному контракту DC Next.
 *
 * HMAC-сравнение — ОБЩАЯ функция `verifyHmacSha256Signature` (`webhook-hmac-signature.util.ts`,
 * `02` C15), та же, что у `MockBankWebhookVerifierAdapter`/`AlifMobiWebhookVerifierAdapter`.
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

/** ASSUMPTION (смоделировано по Alifpay, research 03 §2.7 — у DC Next нет своей публичной документации). */
export const DC_NEXT_SIGNATURE_HEADER = 'signature'

/** ASSUMPTION — та же форма, что `RawAlifMobiWebhookBody` (у DC Next нет своего документированного контракта). */
interface RawDcNextWebhookBody {
  readonly event_id: string
  readonly invoice_id: string
  readonly status: 'DONE' | 'FAILED' | 'REFUNDED' | 'REFUND_FAILED'
  readonly amount: string
  readonly created_at: string
}

const DC_NEXT_STATUS_TO_TYPE: Readonly<Record<RawDcNextWebhookBody['status'], VerifiedWebhookPayload['type']>> = {
  DONE: 'payment_confirmed',
  FAILED: 'payment_failed',
  REFUNDED: 'refund_confirmed',
  REFUND_FAILED: 'refund_failed',
}

function isRawDcNextWebhookBody(value: unknown): value is RawDcNextWebhookBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.event_id === 'string' &&
    typeof body.invoice_id === 'string' &&
    typeof body.status === 'string' &&
    body.status in DC_NEXT_STATUS_TO_TYPE &&
    typeof body.amount === 'string' &&
    typeof body.created_at === 'string'
  )
}

@Injectable()
export class DcNextWebhookVerifierAdapter implements BankWebhookVerifierPort {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public verify(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Result<VerifiedWebhookPayload, InvalidWebhookSignatureError> {
    const signature = headers[DC_NEXT_SIGNATURE_HEADER]
    if (!verifyHmacSha256Signature({ rawBody, providedSignature: signature, secret: this.config.dcNextWebhookSecret, encoding: 'base64' })) {
      return { ok: false, error: new InvalidWebhookSignatureError({ provider: 'dc_next' }) }
    }
    return this.parsePayload(rawBody)
  }

  private parsePayload(rawBody: Buffer): Result<VerifiedWebhookPayload, InvalidWebhookSignatureError> {
    // SRS-PAY-020: JSON.parse ПОСЛЕ подтверждения подписи — см. JSDoc MockBankWebhookVerifierAdapter.
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'))
    if (!isRawDcNextWebhookBody(parsed)) {
      throw new Error('dc_next webhook body passed HMAC but has an unexpected shape — producer/consumer drift')
    }
    return {
      ok: true,
      value: {
        bankEventId: parsed.event_id,
        providerRef: parsed.invoice_id,
        type: DC_NEXT_STATUS_TO_TYPE[parsed.status],
        amountDiram: BigInt(parsed.amount),
        occurredAt: new Date(parsed.created_at),
      },
    }
  }
}
