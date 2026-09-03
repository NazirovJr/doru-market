/**
 * `MockBankWebhookVerifierAdapter` (EP-10, DTJ-238, §5.2/§3.2 SRS-PAY-005) — реализация
 * `BankWebhookVerifierPort` (DTJ-237) для `mock_bank`.
 *
 * HMAC-SHA256 по СЫРЫМ байтам `rawBody` с `MOCK_BANK_WEBHOOK_SECRET` — ТОТ ЖЕ алгоритм/код-путь,
 * что зарезервирован для `AlifMobiProvider`/`DcNextProvider` (R3): полиморфизм по
 * `providerName` через `BankWebhookVerifierPort`, НЕ отдельная ветка `if (isMock)` в
 * обработчике вебхука (SRS-PAY-005, AC5 DTJ-238) — этот класс СТРУКТУРНО — один из N
 * равноправных адаптеров интерфейса, вызывающий код (`HandlePaymentWebhookUseCase`, DTJ-243)
 * не знает и не обязан знать, что это мок.
 *
 * Заголовок подписи и hex-кодирование — тот же паттерн, что `DrizzlePharmacyApiKeyVerification
 * Adapter` (`modules/inventory/infrastructure/adapters/`, `x-pharmacy-signature`,
 * `timingSafeEqual` на байтах, не на длине hex-строки) — ASSUMPTION имени заголовка
 * (`X-Webhook-Signature`) этого тикета: ни один реальный банковский контракт TJ не
 * опубликован (research 03), точное имя уточнит DTJ-239/240 при получении реального контракта.
 *
 * **DTJ-239 (`02` C15):** само HMAC-сравнение вынесено в общую `verifyHmacSha256Signature`
 * (`webhook-hmac-signature.util.ts`) — DoD DTJ-239 требует ОДНУ реализацию для ВСЕХ трёх
 * верификаторов (mock/Alif/DC), не три копии алгоритма. Поведение этого файла не изменилось —
 * `hasValidSignature` теперь тонкая обёртка, вызывающая ту же логику, что и раньше.
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

/** ASSUMPTION (DTJ-238): нет опубликованного контракта реального банка РТ — см. JSDoc файла. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature'

interface RawMockBankWebhookBody {
  readonly bankEventId: string
  readonly providerRef: string
  readonly type: VerifiedWebhookPayload['type']
  readonly amountDiram: string
  readonly occurredAt: string
}

function isRawMockBankWebhookBody(value: unknown): value is RawMockBankWebhookBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.bankEventId === 'string' &&
    typeof body.providerRef === 'string' &&
    typeof body.type === 'string' &&
    typeof body.amountDiram === 'string' &&
    typeof body.occurredAt === 'string'
  )
}

@Injectable()
export class MockBankWebhookVerifierAdapter implements BankWebhookVerifierPort {
  public constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  public verify(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Result<VerifiedWebhookPayload, InvalidWebhookSignatureError> {
    if (!this.hasValidSignature(rawBody, headers)) {
      return { ok: false, error: new InvalidWebhookSignatureError({ provider: 'mock_bank' }) }
    }
    return this.parsePayload(rawBody)
  }

  private hasValidSignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    return verifyHmacSha256Signature({
      rawBody,
      providedSignature: headers[WEBHOOK_SIGNATURE_HEADER],
      secret: this.config.mockBankWebhookSecret,
      encoding: 'hex',
    })
  }

  private parsePayload(rawBody: Buffer): Result<VerifiedWebhookPayload, InvalidWebhookSignatureError> {
    // SRS-PAY-020: JSON.parse ПОСЛЕ подтверждения подписи, не до. Подпись уже подтверждена
    // (hasValidSignature) на момент вызова — тело гарантированно от держателя секрета; ошибка
    // парсинга здесь — программный дефект (несовместимая версия producer/consumer), не попытка
    // подделки, поэтому не маскируется под `InvalidWebhookSignatureError`.
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'))
    if (!isRawMockBankWebhookBody(parsed)) {
      throw new Error('mock_bank webhook body passed HMAC but has an unexpected shape — producer/consumer drift')
    }
    return {
      ok: true,
      value: {
        bankEventId: parsed.bankEventId,
        providerRef: parsed.providerRef,
        type: parsed.type,
        amountDiram: BigInt(parsed.amountDiram),
        occurredAt: new Date(parsed.occurredAt),
      },
    }
  }
}
