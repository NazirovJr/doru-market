/**
 * `DcNextProvider` (EP-10, DTJ-239, `21-module-orders-payments-escrow.md` §3.3, SRS-PAY-006/
 * 007) — реализация `PaymentProvider` (DTJ-237). Структура методов идентична
 * `AlifMobiProvider`/`MockBankProvider` (DTJ-238/239) — та же публичная поверхность, тот же
 * принцип «проверить локально (`payment_operations`), затем вызвать провайдера»
 * (SRS-PAY-003), но HTTP-вызовы реальные (`fetch`, `bank-fetch.util.ts`).
 *
 * **Заготовка R1, включение R3 (SRS-PAY-006).** Существует, компилируется, покрыта unit-
 * тестами на ASSUMPTION-контракте — НЕ подключается к реальному production-трафику: переключение
 * `PAYMENT_DRIVER=dc_next` блокируется `tenant_settings.enabledPaymentMethods` (SRS-ORD-025,
 * дефолт R1 — только `cash_courier`), см. явный комментарий в `payments.module.ts` рядом с
 * DI-биндингом (DTJ-239 «Что сделать» п.6).
 *
 * // ASSUMPTION: контракт не подтверждён банком, research 03 §4 — DC Next (Dushanbe City Bank)
 * // НЕ публикует НИКАКОЙ технической API-документации для мерчантов («UNVERIFIED: публичный
 * // API эквайринга для частных маркетплейсов»). Контракт этого адаптера смоделирован ПО
 * // АНАЛОГИИ с Alifpay (research 03 §2.1/§2.2, тот же референс, что `AlifMobiProvider`) — тот
 * // же выбор, зафиксированный SRS-PAY-006 для ОБОИХ банков сразу, НЕ гарантированно идентично
 * // реальному контракту DC Next.
 *
 * Идемпотентность (SRS-PAY-003) — общие функции `findCachedProviderRef`/`recordBankOperation`
 * (`bank-invoice-operation.util.ts`, `02` C15, разделены с `AlifMobiProvider`).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Result } from '@dorutj/domain-kernel'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { AppConfigService } from '@/config/app-config.service.js'
import {
  type CreateInvoiceCommand,
  type InvoiceRef,
  type PaymentProvider,
  type PaymentProviderCapabilities,
  type PaymentStatusSnapshot,
  type RefundRef,
} from '@/modules/payments/application/ports/payment-provider.port.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'
import { NotSupportedByProviderError } from '@/modules/payments/domain/errors/not-supported-by-provider.error.js'
import { findCachedProviderRef, findOriginalOperation, recordBankOperation } from './bank-invoice-operation.util.js'
import { postJsonToBank, type BankFetchError } from './bank-fetch.util.js'

const DC_NEXT_PROVIDER_NAME = 'dc_next' as const
const MINUTES_TO_MS = 60_000

/** ASSUMPTION (смоделировано по research 03 §2.2, у DC Next нет своего документированного контракта). */
interface DcNextCreateInvoiceResponse {
  readonly id: string
  readonly price: string
  readonly created_at: string
}

/** ASSUMPTION — форма ответа рефанда, та же, что `AlifRefundResponse` (`alif-mobi.provider.ts`). */
interface DcNextRefundResponse {
  readonly id: string
  readonly status: 'DONE' | 'PENDING' | 'FAILED'
}

@Injectable()
export class DcNextProvider implements PaymentProvider {
  public constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  public capabilities(): PaymentProviderCapabilities {
    return {
      providerName: DC_NEXT_PROVIDER_NAME,
      // SRS-PAY-007: та же оговорка, что AlifMobiProvider — hold недоступен для QR-инвойса без
      // сохранённой карты/кошелька, ASSUMPTION по аналогии (research 03 §2.5).
      supportsHoldCapture: false,
      supportsPartialRefund: false,
      maxInvoiceValidityMinutes: this.config.bankInvoiceValidityMinutes,
    }
  }

  public async createInvoice(cmd: CreateInvoiceCommand): Promise<Result<InvoiceRef, PaymentProviderError>> {
    try {
      const cached = await findCachedProviderRef(this.db, cmd.idempotencyKey)
      const providerRef = cached ?? (await this.callCreateInvoice(cmd))
      return { ok: true, value: this.toInvoiceRef(providerRef) }
    } catch (error) {
      return { ok: false, error: toPaymentProviderError(error, DC_NEXT_PROVIDER_NAME) }
    }
  }

  public async getStatus(providerRef: string): Promise<Result<PaymentStatusSnapshot, PaymentProviderError>> {
    const original = await findOriginalOperation(this.db, providerRef)
    if (original === undefined) {
      return { ok: false, error: new PaymentProviderError('PROVIDER_REF_NOT_FOUND', `Unknown providerRef: ${providerRef}`) }
    }
    // SRS-PAY-002: только диагностика/реконсиляция — НИКОГДА не меняет order.status.
    return {
      ok: true,
      value: {
        providerRef,
        status: original.status === 'succeeded' ? 'paid' : original.status,
        amountDiram: original.amountDiram,
        paidAt: null,
      },
    }
  }

  public async refund(providerRef: string, idempotencyKey: string): Promise<Result<RefundRef, PaymentProviderError>> {
    try {
      const original = await findOriginalOperation(this.db, providerRef)
      if (original === undefined) {
        return { ok: false, error: new PaymentProviderError('PROVIDER_REF_NOT_FOUND', `Unknown providerRef: ${providerRef}`) }
      }
      const cachedRefundRef = await findCachedProviderRef(this.db, idempotencyKey)
      const refundProviderRef = cachedRefundRef ?? (await this.callRefund(original, providerRef, idempotencyKey))
      return { ok: true, value: { providerRefundRef: refundProviderRef, amountDiram: original.amountDiram, status: 'pending' } }
    } catch (error) {
      return { ok: false, error: toPaymentProviderError(error, DC_NEXT_PROVIDER_NAME) }
    }
  }

  public partialRefund(
    _providerRef: string,
    _amountDiram: bigint,
    _idempotencyKey: string,
  ): Promise<Result<RefundRef, PaymentProviderError>> {
    // capabilities().supportsPartialRefund === false — JSDoc `PaymentProvider.partialRefund`.
    return Promise.resolve({ ok: false, error: new NotSupportedByProviderError('partialRefund', DC_NEXT_PROVIDER_NAME) })
  }

  private async callCreateInvoice(cmd: CreateInvoiceCommand): Promise<string> {
    const url = `${this.requireBaseUrl()}/invoice`
    const response = await postJsonToBank<DcNextCreateInvoiceResponse>(
      url,
      {
        amount: cmd.amountDiram.toString(),
        phone: cmd.customerPhone,
        webhook_url: '/api/v1/payments/webhook',
        meta: { orderId: cmd.orderId, description: cmd.description, idempotencyKey: cmd.idempotencyKey },
      },
      this.config.dcNextApiToken,
    )
    return recordBankOperation(this.db, {
      orderId: cmd.orderId,
      idempotencyKey: cmd.idempotencyKey,
      provider: DC_NEXT_PROVIDER_NAME,
      providerRef: response.id,
      amountDiram: cmd.amountDiram,
      operationType: 'create_bill',
      status: 'pending',
    })
  }

  private async callRefund(
    original: { readonly orderId: string; readonly amountDiram: bigint },
    providerRef: string,
    idempotencyKey: string,
  ): Promise<string> {
    const url = `${this.requireBaseUrl()}/refund`
    const response = await postJsonToBank<DcNextRefundResponse>(
      url,
      { invoice_id: providerRef, amount: original.amountDiram.toString(), id: idempotencyKey },
      this.config.dcNextApiToken,
    )
    return recordBankOperation(this.db, {
      orderId: original.orderId,
      idempotencyKey,
      provider: DC_NEXT_PROVIDER_NAME,
      providerRef: response.id,
      amountDiram: original.amountDiram,
      operationType: 'refund',
      status: response.status === 'DONE' ? 'succeeded' : response.status === 'FAILED' ? 'failed' : 'pending',
    })
  }

  private toInvoiceRef(providerRef: string): InvoiceRef {
    return {
      providerRef,
      // ASSUMPTION — та же схема deeplink, что AlifMobiProvider (у DC Next нет документированной своей).
      qrPayload: `https://pay.dc.tj/?invoice=${providerRef}`,
      expiresAt: new Date(Date.now() + this.config.bankInvoiceValidityMinutes * MINUTES_TO_MS),
    }
  }

  private requireBaseUrl(): string {
    const baseUrl = this.config.dcNextApiBaseUrl
    if (baseUrl === undefined) {
      // R1: недостижимо в проде (см. JSDoc файла) — если всё же вызвано без конфигурации,
      // громкий отказ лучше молчаливого запроса на "undefined/invoice".
      throw new Error('DC_NEXT_API_BASE_URL is not configured — dc_next is not enabled in this environment (R3)')
    }
    return baseUrl
  }
}

function toPaymentProviderError(error: unknown, providerName: string): PaymentProviderError {
  if (error instanceof PaymentProviderError) {
    return error
  }
  const httpStatus = (error as BankFetchError | undefined)?.httpStatus
  const message = error instanceof Error ? error.message : String(error)
  return new PaymentProviderError('BANK_REQUEST_FAILED', `${providerName} request failed: ${message}`, { httpStatus })
}
