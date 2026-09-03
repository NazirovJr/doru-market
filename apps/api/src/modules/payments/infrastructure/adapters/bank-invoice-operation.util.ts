/**
 * Общая идемпотентность `payment_operations` (SRS-PAY-003) для РЕАЛЬНЫХ адаптеров
 * `PaymentProvider` (`AlifMobiProvider`/`DcNextProvider`, EP-10 DTJ-239). В отличие от
 * `MockBankProvider` (DTJ-238), которому НЕ нужен сетевой вызов, чтобы получить `providerRef`
 * (генерирует его сам ДО записи), реальный банк возвращает `providerRef` только В ОТВЕТ на
 * HTTP-вызов — порядок операций неизбежно другой, но принцип SRS-PAY-003 тот же: «проверить
 * локально, затем вызвать провайдера» — `findCachedProviderRef` вызывается ПЕРВЫМ, сетевой
 * вызов (в самом провайдере) — только если локально ничего не найдено.
 *
 * `02` C15 — вынесено в общий файл, а не продублировано между `alif-mobi.provider.ts` и
 * `dc-next.provider.ts` (третье почти идентичное повторение, считая уже существующий
 * `MockBankProvider.insertOrReuseOperation`, DTJ-238, который не тронут этим тикетом — эта
 * функция не подменяет его, она разделяется ТОЛЬКО между двумя новыми адаптерами).
 */
import { eq } from 'drizzle-orm'
import type { DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { paymentOperations } from '@/db/schema/payments.js'

export interface RecordBankOperationInput {
  readonly orderId: string
  readonly idempotencyKey: string
  readonly provider: string
  readonly providerRef: string
  readonly amountDiram: bigint
  readonly operationType: 'create_bill' | 'refund'
  readonly status: 'pending' | 'succeeded' | 'failed'
}

/** Given строка по `idempotencyKey` уже существует с проставленным `providerRef` — вернуть его без сетевого вызова. */
export async function findCachedProviderRef(db: DrizzleDb, idempotencyKey: string): Promise<string | undefined> {
  const rows = await db
    .select({ providerRef: paymentOperations.providerRef })
    .from(paymentOperations)
    .where(eq(paymentOperations.idempotencyKey, idempotencyKey))
    .limit(1)
  return rows[0]?.providerRef ?? undefined
}

export interface OriginalOperation {
  readonly orderId: string
  readonly amountDiram: bigint
  readonly status: 'pending' | 'succeeded' | 'failed'
}

export async function findOriginalOperation(db: DrizzleDb, providerRef: string): Promise<OriginalOperation | undefined> {
  const rows = await db
    .select({ orderId: paymentOperations.orderId, amountDiram: paymentOperations.amountDiram, status: paymentOperations.status })
    .from(paymentOperations)
    .where(eq(paymentOperations.providerRef, providerRef))
    .limit(1)
  return rows[0]
}

/**
 * Записывает результат УЖЕ выполненного сетевого вызова. Конкурентная гонка на тот же
 * `idempotencyKey` (оба вызова прошли `findCachedProviderRef` ДО того, как любой успел
 * вставить строку) — `ON CONFLICT DO NOTHING` отдаёт "проигравшему" `providerRef` ПОБЕДИВШЕЙ
 * строки, не свой собственный (тот же компромисс, что у `MockBankProvider`: локальная
 * идемпотентность защищает от повторной обработки НА НАШЕЙ стороне; полная защита от гонки НА
 * СТОРОНЕ банка — ответственность нативного идемпотентного параметра запроса банка,
 * SRS-PAY-003 п.1, вне периметра этого тикета — research 03 §2.5 подтверждает, что `/hold`
 * поддерживает клиентский `id` именно для этого).
 */
export async function recordBankOperation(db: DrizzleDb, input: RecordBankOperationInput): Promise<string> {
  const inserted = await db
    .insert(paymentOperations)
    .values({
      orderId: input.orderId,
      operationType: input.operationType,
      idempotencyKey: input.idempotencyKey,
      provider: input.provider,
      providerRef: input.providerRef,
      status: input.status,
      amountDiram: input.amountDiram,
    })
    .onConflictDoNothing({ target: paymentOperations.idempotencyKey })
    .returning({ providerRef: paymentOperations.providerRef })
  const insertedRef = inserted[0]?.providerRef
  if (insertedRef !== undefined && insertedRef !== null) {
    return insertedRef
  }
  const existing = await findCachedProviderRef(db, input.idempotencyKey)
  if (existing === undefined) {
    throw new Error('payment_operations row vanished after conflict — concurrent delete?')
  }
  return existing
}
