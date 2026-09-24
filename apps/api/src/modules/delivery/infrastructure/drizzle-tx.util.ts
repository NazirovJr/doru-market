import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: DeliveryUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
