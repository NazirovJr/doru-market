/**
 * `DrizzlePaymentWebhookOperationsRepository` (EP-10, DTJ-242) — реализация
 * `PaymentWebhookOperationsPort` поверх `payment_operations` (DTJ-236, `db/schema/payments.js`,
 * миграция `0029_payments.sql` + `0033_payment_operations_webhook_event_types.sql` — 4 новых
 * значения `payment_operation_type`, см. JSDoc миграции).
 *
 * `findOrderByProviderRef` — JOIN `orders` ОДНИМ запросом (не два раунд-трипа): `payment_
 * operations` своей колонки `tenant_id` не несёт (та же схема, что `escrow_ledger`,
 * `DrizzleEscrowLedgerRepository` JSDoc) — тенант резолвится ТОЛЬКО через `orders.tenant_id`.
 *
 * `recordEventIfNew` — `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`
 * (SRS-DOM-164/SRS-PAY-022) — `idempotency_key = bankEventId`. Пустой массив `RETURNING` ⇒
 * конфликт ⇒ дубликат события (`false`), непустой ⇒ новая строка (`true`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { paymentOperations } from '@/db/schema/payments.js'
import { orders } from '@/db/schema/orders.js'
import {
  PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY,
  type OriginalPaymentOperationRef,
  type PaymentWebhookOperationsPort,
  type PaymentsUnitOfWorkTx,
  type RecordWebhookEventInput,
} from '@/modules/payments/application/ports/payment-webhook-operations.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const OPERATION_STATUS_SUCCEEDED = 'succeeded'
const OPERATION_STATUS_FAILED = 'failed'
/** DTJ-243, SRS-PAY-025 — см. JSDoc `findRefundOperationRef` в порте про отступление от `status='pending'`. */
const REFUND_OPERATION_TYPES = ['refund', 'partial_refund'] as const

@Injectable()
export class DrizzlePaymentWebhookOperationsRepository implements PaymentWebhookOperationsPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findOrderByProviderRef(providerRef: string, tx?: PaymentsUnitOfWorkTx): Promise<OriginalPaymentOperationRef | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select({ orderId: paymentOperations.orderId, tenantId: orders.tenantId })
      .from(paymentOperations)
      .innerJoin(orders, eq(paymentOperations.orderId, orders.id))
      // DTJ-243, SRS-PAY-040: soft-deleted заказ трактуется как неизвестный платёж — фильтр
      // ЗДЕСЬ (не отдельной веткой в use case), т.к. это ТА ЖЕ проверка "найден ли заказ".
      .where(and(eq(paymentOperations.providerRef, providerRef), isNull(orders.deletedAt)))
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : { orderId: row.orderId, tenantId: row.tenantId }
  }

  public async findRefundOperationRef(providerRef: string, tx?: PaymentsUnitOfWorkTx): Promise<OriginalPaymentOperationRef | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select({ orderId: paymentOperations.orderId, tenantId: orders.tenantId })
      .from(paymentOperations)
      .innerJoin(orders, eq(paymentOperations.orderId, orders.id))
      .where(
        and(
          eq(paymentOperations.providerRef, providerRef),
          inArray(paymentOperations.operationType, REFUND_OPERATION_TYPES),
          isNull(orders.deletedAt),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : { orderId: row.orderId, tenantId: row.tenantId }
  }

  public async recordEventIfNew(input: RecordWebhookEventInput, tx: PaymentsUnitOfWorkTx): Promise<boolean> {
    const client = resolveDrizzleClient(this.db, tx)
    const inserted = await client
      .insert(paymentOperations)
      .values({
        orderId: input.orderId,
        operationType: input.operationType,
        idempotencyKey: input.bankEventId,
        provider: input.provider,
        providerRef: input.providerRef,
        status: input.succeeded ? OPERATION_STATUS_SUCCEEDED : OPERATION_STATUS_FAILED,
        amountDiram: input.amountDiram,
        rawWebhookPayload: input.rawWebhookPayload,
      })
      .onConflictDoNothing({ target: paymentOperations.idempotencyKey })
      .returning({ id: paymentOperations.id })
    return inserted.length > 0
  }
}

export const PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY_PROVIDER = {
  provide: PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY,
  useClass: DrizzlePaymentWebhookOperationsRepository,
} as const
