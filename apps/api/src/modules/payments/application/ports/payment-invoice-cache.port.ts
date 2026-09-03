/**
 * Порт `PaymentInvoiceCacheRepositoryPort` (EP-10, DTJ-241, `02-CLEAN-ARCHITECTURE-AND-CODE.md`
 * §1.3) — `CreatePaymentInvoiceUseCase`'s собственный «прочитать локально, затем вызвать
 * провайдера» слой (SRS-PAY-003) поверх `payment_operations.qr_payload`/`expires_at`
 * (миграция `0032_payment_operations_invoice_cache.sql`), реализация —
 * `infrastructure/repositories/drizzle-payment-invoice-cache.repository.ts`.
 *
 * Вынесен ОТДЕЛЬНЫМ портом от `payment-provider.port.ts` намеренно: `application/**` не
 * имеет права импортировать Drizzle/схему БД напрямую (`02` §1.1) — use case сам по себе НЕ
 * трогает `payment_operations`; эта прослойка — единственный легальный способ дать ему такую
 * возможность, не нарушая направление зависимостей.
 */
export const PAYMENT_INVOICE_CACHE_REPOSITORY = Symbol.for('@dorutj/payments/payment-invoice-cache-repository')

export interface CachedInvoiceRecord {
  readonly providerRef: string
  readonly qrPayload: string
  readonly expiresAt: Date
}

export interface PaymentInvoiceCacheRepositoryPort {
  /** `null` — записи нет ИЛИ она ещё не полностью завершена (см. JSDoc реализации). */
  findCached(idempotencyKey: string): Promise<CachedInvoiceRecord | null>
  /** Добавляет `qrPayload`/`expiresAt` к УЖЕ существующей строке (создана `PaymentProvider`-адаптером). */
  backfill(idempotencyKey: string, invoice: CachedInvoiceRecord): Promise<void>
}
