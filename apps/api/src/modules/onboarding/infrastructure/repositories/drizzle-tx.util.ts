// Тот же приём, что payments/infrastructure/drizzle-tx.util.ts — своя копия, межмодульный импорт infrastructure запрещён.
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: unknown): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
