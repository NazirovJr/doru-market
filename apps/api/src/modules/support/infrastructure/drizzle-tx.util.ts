/**
 * Общий хелпер Drizzle-адаптеров `support` (DTJ-279) — 1:1 паттерн `payments/infrastructure/
 * drizzle-tx.util.ts` (DTJ-242), заведён заново (межмодульный deep-import чужого
 * `infrastructure/**` запрещён, `02` §1.2).
 */
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import type { SupportUnitOfWorkTx } from '@/modules/support/application/ports/support-unit-of-work.port.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: SupportUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
