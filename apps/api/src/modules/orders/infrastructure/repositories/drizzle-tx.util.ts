/**
 * Общий хелпер Drizzle-репозиториев/адаптеров `orders` (EP-09, DTJ-227) — 1:1 паттерн
 * `modules/auth/infrastructure/repositories/drizzle-tx.util.ts` (волна 5), заведённый заново
 * (не импортирован оттуда напрямую — межмодульный deep-import чужой `infrastructure/`
 * запрещён depcruise `no-cross-module-deep-import`, `02` §1.2).
 *
 * `OrdersUnitOfWorkPort.run(callback)` передаёт непрозрачный `tx: OrderUnitOfWorkTx`
 * (`= unknown`). Здесь, во infrastructure-слое, тип известен — `resolveDrizzleClient`
 * возвращает либо переданный `tx` (внутри транзакции группы checkout), либо дефолтный пул
 * `db`, если метод вызван вне транзакции (`tx` отсутствует/`null`/`undefined`).
 */
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { type OrderUnitOfWorkTx } from '@/modules/orders/application/ports/order-repository.port.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: OrderUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
