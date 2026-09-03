/**
 * Общий хелпер Drizzle-адаптеров `inventory` (волна 6, self-deadlock пула соединений) —
 * 1:1 паттерн `modules/auth/infrastructure/repositories/drizzle-tx.util.ts` /
 * `modules/orders/infrastructure/repositories/drizzle-tx.util.ts`, заведённый заново
 * (не импортирован оттуда напрямую — межмодульный deep-import чужой `infrastructure/`
 * запрещён depcruise `no-cross-module-deep-import`, `02` §1.2).
 *
 * `UnitOfWorkPort.run(callback)` (порт — из `modules/auth` через публичный фасад,
 * D-27, инвентарь не имеет своего UoW-порта) передаёт непрозрачный `tx: UnitOfWorkTx`
 * (`= unknown`). Здесь, во infrastructure-слое, тип известен — `resolveDrizzleClient`
 * возвращает либо переданный `tx` (внутри транзакции
 * `IngestInventoryBatchWithMatchingUseCase.execute`), либо дефолтный пул `db`, если
 * метод вызван вне транзакции (`tx` отсутствует/`null`/`undefined`).
 */
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { type UnitOfWorkTx } from '@/modules/auth/index.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: UnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
