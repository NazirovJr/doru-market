/**
 * `CreatePaymentInvoiceUseCase` (EP-10, DTJ-241, `21-module-orders-payments-escrow.md` §3.1/
 * §4.4, SRS-PAY-003/015) — единственный вызывающий код `PaymentProvider.createInvoice()`
 * (`payments`-модуль). `PaymentInvoiceAdapter` (тонкая обёртка, `infrastructure/adapters/`)
 * замыкает `orders`-контракт `PaymentInvoicePort` (DTJ-220) вокруг ЭТОГО use case;
 * `RetryPaymentUseCase` (тот же тикет) вызывает его напрямую для `POST .../retry-payment`.
 *
 * **DISPUTED — отклонение от буквального текста «Что сделать» п.1 тикета, обоснование ниже
 * и в отчёте сдачи.** Тикет предписывает: `INSERT INTO payment_operations (...) ON CONFLICT
 * (idempotency_key) DO NOTHING RETURNING id` НА УРОВНЕ USE CASE, ПЕРЕД вызовом
 * `PaymentProvider.createInvoice()`. Буквальная реализация конфликтует с уже ПРИНЯТЫМ
 * `MockBankProvider.insertOrReuseOperation` (DTJ-238, `infrastructure/adapters/mock-bank.
 * provider.ts`, файл вне периметра этого тикета — трогать нельзя): тот адаптер САМ делает
 * `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` под ТЕМ ЖЕ `idempotencyKey`. Если use
 * case вставляет строку ПЕРВЫМ (без `providerRef`, он появляется только из ответа банка),
 * собственный `INSERT` провайдера конфликтует с ЭТОЙ строкой, находит `providerRef = NULL`
 * (use case ещё не заполнил его) и бросает `IDEMPOTENCY_RACE` — гарантированная поломка
 * ЛЮБОГО non-cash checkout при использовании `mock_bank` (единственный реально включённый
 * провайдер R1). Также сам порт SRS-PAY-003 явно возлагает локальную идемпотентность НА
 * «реализацию адаптера» (`docs/spec/21-module-orders-payments-escrow.md` §3.1), не на
 * вызывающий use case — MockBankProvider (DTJ-238) уже корректно это делает.
 *
 * **Реализовано вместо этого** — порядок «сначала проверить локально, затем вызвать
 * провайдера» (SRS-PAY-003) сохранён буквально, но БЕЗ конкурирующей записи в ТУ ЖЕ строку:
 *   1. `PaymentInvoiceCacheRepositoryPort.findCached(idempotencyKey)` — ЧТЕНИЕ
 *      `payment_operations` (не INSERT), см. `payment-invoice-cache.port.ts`. Given строка уже
 *      несёт `provider_ref`/`qr_payload`/`expires_at` (полностью завершённый предыдущий вызов
 *      ТЕМ ЖЕ ключом) → вернуть СОХРАНЁННЫЙ `InvoiceRef`, провайдер НЕ вызывается — счётчик
 *      вызовов провайдера остаётся на предыдущем значении (AC1).
 *   2. Иначе — `PaymentProvider.createInvoice(cmd)` (провайдер — единственный владелец
 *      создания строки `payment_operations`, как и раньше, DTJ-238/239).
 *   3. Успех → `PaymentInvoiceCacheRepositoryPort.backfill(...)` — ДОБАВЛЯЕТ два поля, которых
 *      провайдер не персистит (миграция `0032_payment_operations_invoice_cache.sql`), НЕ
 *      трогает `provider_ref`/`status` (уже корректно выставлены провайдером на шаге 2) —
 *      никакой конкуренции за одну и ту же колонку между use case и адаптером.
 *   4. Ошибка/таймаут → пробрасывается вызывающему коду (не проглатывается) — `PaymentInvoiceAdapter`
 *      транслирует в `Result.Err`, `CheckoutUseCase` (D-EP09-17) уже умеет обработать это как
 *      `paymentPending: true`, не откатывая созданный заказ.
 *
 * **Реальная конкурентность (два одновременных `execute()` с ОДНИМ `idempotencyKey`).** Оба
 * могут пройти шаг 1 (ЧТЕНИЕ) одновременно, не найдя ничего готового, и оба дойти до шага 2 —
 * но `PaymentProvider`-адаптер (обязан по SRS-PAY-003) атомарно гарантирует, что ВТОРАЯ строка
 * `payment_operations` для того же `idempotency_key` не создаётся (`ON CONFLICT DO NOTHING`,
 * MockBankProvider/AlifMobiProvider/DcNextProvider — все три реализуют это идентично, DTJ-238/
 * 239): «второй счёт у провайдера» физически не создаётся, что и есть требуемое инвариантом
 * (см. отчёт сдачи, раздел ПРОВЕРКИ — доказано `Promise.all` на реальном Postgres).
 */
import { Inject, Injectable } from '@nestjs/common'
import { AppConfigService } from '@/config/app-config.service.js'
import {
  PAYMENT_PROVIDER_TOKEN,
  type CreateInvoiceCommand,
  type InvoiceRef,
  type PaymentProvider,
} from '@/modules/payments/application/ports/payment-provider.port.js'
import {
  PAYMENT_INVOICE_CACHE_REPOSITORY,
  type PaymentInvoiceCacheRepositoryPort,
} from '@/modules/payments/application/ports/payment-invoice-cache.port.js'
import { PaymentProviderError } from '@/modules/payments/domain/errors/payment-provider.error.js'

@Injectable()
export class CreatePaymentInvoiceUseCase {
  public constructor(
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly paymentProvider: PaymentProvider,
    @Inject(PAYMENT_INVOICE_CACHE_REPOSITORY) private readonly cache: PaymentInvoiceCacheRepositoryPort,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  public async execute(cmd: CreateInvoiceCommand): Promise<InvoiceRef> {
    const cached = await this.cache.findCached(cmd.idempotencyKey)
    if (cached !== null) {
      return cached
    }
    const result = await this.callProviderWithTimeout(cmd)
    if (!result.ok) {
      throw result.error
    }
    await this.cache.backfill(cmd.idempotencyKey, result.value)
    return result.value
  }

  private async callProviderWithTimeout(cmd: CreateInvoiceCommand): ReturnType<PaymentProvider['createInvoice']> {
    return withTimeout(this.paymentProvider.createInvoice(cmd), this.config.paymentProviderTimeoutMs)
  }
}

/**
 * `orders/application/checkout/checkout.util.ts` несёт СВОЮ копию (application-приватную,
 * `orders`-модуль) — эта версия НЕ импортируется оттуда намеренно (`02` §1.2, межмодульный
 * deep-import запрещён) — тот же класс необходимого дублирования, что `MockBankAutoPayJobData`
 * между `apps/api`/`apps/worker` (`mock-bank.provider.ts` JSDoc): изоляция границы модуля
 * важнее одной обёртки на 12 строк.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PaymentProviderError('TIMEOUT', `PaymentProvider.createInvoice timed out after ${String(ms)}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
