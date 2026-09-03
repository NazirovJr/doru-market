/**
 * `PaymentInvoiceAdapter` (EP-10, DTJ-241) — реализация `PaymentInvoicePort`, объявленного
 * `orders`-модулем (DTJ-220, `apps/api/src/modules/orders/application/ports/
 * payment-invoice.port.ts`, ре-экспортирован публичным фасадом `orders/index.ts` — межмодульный
 * биндинг через порт, НЕ прямой импорт домена `orders`, `02` §1.2). Контракт
 * `PaymentInvoicePort.createInvoice` ЗАФИКСИРОВАН потребителем (`CheckoutUseCase`, решение
 * D-EP09-17) — этот адаптер реализует его 1:1, не переопределяет.
 *
 * Тонкая обёртка над `CreatePaymentInvoiceUseCase` (тот же тикет): `orders`-сторона типов
 * (`PaymentInvoiceCreateCommand`/`PaymentInvoiceRef`, ре-экспорт `orders/index.ts`) и
 * `payments`-сторона (`CreateInvoiceCommand`/`InvoiceRef`, `payment-provider.port.ts`, DTJ-237)
 * СТРУКТУРНО идентичны (`orderId: string`, `amountDiram: bigint`, `currency: 'TJS'`,
 * `idempotencyKey: string`, `description: string`, `customerPhone: string`) — то же наблюдение,
 * что уже зафиксировано JSDoc `payment-provider.port.ts` («тот же выбор уже сделан
 * `payment-invoice.port.ts`... здесь сохранена симметрия») — маппинг явный, поле-в-поле, а не
 * структурный каст, чтобы расхождение сигнатур ловилось `tsc`, а не рантаймом.
 *
 * Ошибки: любой брошенный `CreatePaymentInvoiceUseCase.execute()` (провайдер вернул `Err`,
 * таймаут — `PaymentProviderError`, JSDoc use case) транслируется в `Result.Err` порта
 * `orders`, НЕ пробрасывается как исключение — `PaymentInvoicePort.createInvoice` объявлен как
 * `Promise<Result<...>>`, вызывающий код (`CheckoutUseCase.tryCreateInvoice`) сначала проверяет
 * `result.ok`, и только НЕОЖИДАННЫЙ throw ловит `catch` как запасной путь (D-EP09-17).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { Result } from '@dorutj/domain-kernel'
import { ErrorCode } from '@dorutj/contracts'
import {
  PAYMENT_INVOICE_PORT,
  type PaymentInvoicePort,
  type PaymentInvoiceCreateCommand,
  type PaymentInvoiceRef,
  type PaymentInvoiceError,
} from '@/modules/orders/index.js'
import { CreatePaymentInvoiceUseCase } from '@/modules/payments/application/use-cases/create-payment-invoice.use-case.js'
import type { CreateInvoiceCommand } from '@/modules/payments/application/ports/payment-provider.port.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'

export { PAYMENT_INVOICE_PORT }

@Injectable()
export class PaymentInvoiceAdapter implements PaymentInvoicePort {
  public constructor(@Inject(CreatePaymentInvoiceUseCase) private readonly createInvoiceUseCase: CreatePaymentInvoiceUseCase) {}

  public async createInvoice(cmd: PaymentInvoiceCreateCommand): Promise<Result<PaymentInvoiceRef, PaymentInvoiceError>> {
    const command: CreateInvoiceCommand = {
      orderId: cmd.orderId,
      amountDiram: cmd.amountDiram,
      currency: cmd.currency,
      idempotencyKey: cmd.idempotencyKey,
      description: cmd.description,
      customerPhone: cmd.customerPhone,
    }
    try {
      const invoice = await this.createInvoiceUseCase.execute(command)
      return { ok: true, value: { providerRef: invoice.providerRef, qrPayload: invoice.qrPayload, expiresAt: invoice.expiresAt } }
    } catch (error) {
      return { ok: false, error: toPaymentInvoiceError(error) }
    }
  }
}

function toPaymentInvoiceError(error: unknown): PaymentInvoiceError {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof PaymentProviderError && error.code === 'TIMEOUT') {
    return { code: ErrorCode.SERVICE_UNAVAILABLE, message }
  }
  return { code: ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, message }
}
