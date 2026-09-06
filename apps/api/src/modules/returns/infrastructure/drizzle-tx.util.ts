/**
 * Общий хелпер Drizzle-адаптеров `returns` (EP-11, DTJ-273) — 1:1 паттерн `support/infrastructure/
 * drizzle-tx.util.ts` (DTJ-279), заведён заново (межмодульный deep-import чужого
 * `infrastructure/**` запрещён, `02` §1.2).
 */
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import type { ReturnsUnitOfWorkTx } from '../application/ports/orders-facade.port.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: ReturnsUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
