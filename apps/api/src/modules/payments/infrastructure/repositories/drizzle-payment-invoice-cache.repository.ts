/**
 * `DrizzlePaymentInvoiceCacheRepository` (EP-10, DTJ-241) — реализация
 * `PaymentInvoiceCacheRepositoryPort` поверх `payment_operations.qr_payload`/`expires_at`
 * (миграция `0032_payment_operations_invoice_cache.sql`, JSDoc там же — владение колонками).
 *
 * `findCached` — Given строка по `idempotencyKey` существует, НО `providerRef`/`qrPayload`/
 * `expiresAt` не ВСЕ заполнены (например, `PaymentProvider`-адаптер уже вставил свою строку, а
 * `CreatePaymentInvoiceUseCase.backfillInvoiceMetadata` ещё не выполнился/упал) — `null`, а не
 * частичный результат: use case САМОИСЦЕЛЯЕТСЯ следующим вызовом (снова дойдёт до провайдера,
 * который вернёт СУЩЕСТВУЮЩИЙ `providerRef` по своей собственной идемпотентности, DTJ-238/239,
 * и use case повторит `backfill`) — недописанный кэш никогда не выдаётся наружу как готовый.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { paymentOperations } from '@/db/schema/payments.js'
import {
  PAYMENT_INVOICE_CACHE_REPOSITORY,
  type CachedInvoiceRecord,
  type PaymentInvoiceCacheRepositoryPort,
} from '@/modules/payments/application/ports/payment-invoice-cache.port.js'

@Injectable()
export class DrizzlePaymentInvoiceCacheRepository implements PaymentInvoiceCacheRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findCached(idempotencyKey: string): Promise<CachedInvoiceRecord | null> {
    const rows = await this.db
      .select({
        providerRef: paymentOperations.providerRef,
        qrPayload: paymentOperations.qrPayload,
        expiresAt: paymentOperations.expiresAt,
      })
      .from(paymentOperations)
      .where(eq(paymentOperations.idempotencyKey, idempotencyKey))
      .limit(1)
    const row = rows[0]
    if (row?.providerRef === undefined || row.providerRef === null || row.qrPayload === null || row.expiresAt === null) {
      return null
    }
    return { providerRef: row.providerRef, qrPayload: row.qrPayload, expiresAt: row.expiresAt }
  }

  public async backfill(idempotencyKey: string, invoice: CachedInvoiceRecord): Promise<void> {
    await this.db
      .update(paymentOperations)
      .set({ qrPayload: invoice.qrPayload, expiresAt: invoice.expiresAt })
      .where(eq(paymentOperations.idempotencyKey, idempotencyKey))
  }
}

export const PAYMENT_INVOICE_CACHE_REPOSITORY_PROVIDER = {
  provide: PAYMENT_INVOICE_CACHE_REPOSITORY,
  useClass: DrizzlePaymentInvoiceCacheRepository,
} as const
