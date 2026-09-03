/**
 * Общий хелпер Drizzle-адаптеров `payments`, введённых DTJ-242 (`orders-facade.adapter.ts`,
 * `drizzle-payment-webhook-operations.repository.ts`, `drizzle-payments-unit-of-work.adapter.ts`,
 * `drizzle-payments-outbox.adapter.ts`) — 1:1 паттерн `orders/infrastructure/repositories/
 * drizzle-tx.util.ts` (DTJ-227), заведён заново (не импортирован оттуда — межмодульный
 * deep-import чужого `infrastructure/**` запрещён, `02` §1.2). `escrow-ledger.repository.ts`
 * (DTJ-240) несёт СВОЮ приватную копию этой же трёхстрочной функции — не рефакторится этим
 * тикетом (файл вне `files_owned` DTJ-242, D-27 «не переписывать barrel/чужой файл целиком»);
 * это ОБЩАЯ версия для новых файлов ЭТОГО тикета, чтобы не плодить четвёртую копию.
 *
 * `resolveDrizzleClient(db, tx)` — либо переданный `tx` (внутри транзакции вебхука,
 * `PaymentsUnitOfWorkPort.run`), либо дефолтный пул `db` (вызов вне транзакции — напр.
 * read-only `getOrderById` без `tx`).
 */
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import type { PaymentsUnitOfWorkTx } from '@/modules/payments/application/ports/orders-facade.port.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: PaymentsUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
