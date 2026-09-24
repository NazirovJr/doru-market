/**
 * Общий хелпер Drizzle-адаптеров `delivery` (DTJ-314) — 1:1 паттерн `support/infrastructure/
 * drizzle-tx.util.ts` (DTJ-279)/`payments/infrastructure/drizzle-tx.util.ts` (DTJ-242), заведён
 * заново (межмодульный deep-import чужого `infrastructure/**` запрещён, `02` §1.2).
 */
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: DeliveryUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
