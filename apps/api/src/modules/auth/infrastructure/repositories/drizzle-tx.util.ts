/**
 * Общий хелпер Drizzle-репозиториев `auth` (волна 5, блок A — персистентность).
 *
 * `UnitOfWorkPort.run(callback)` передаёт репозиториям непрозрачный `tx:
 * UnitOfWorkTx` (`= unknown`, см. JSDoc порта — application-слой не имеет
 * права знать о `DrizzleDb`). Здесь, во infrastructure-слое, тип известен —
 * `resolveDrizzleClient` возвращает либо переданный `tx` (внутри транзакции
 * `DrizzleUnitOfWorkAdapter.run`), либо дефолтный пул `db`, если метод
 * вызван вне транзакции (`tx` отсутствует/`null`/`undefined`).
 */
import { type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { type UnitOfWorkTx } from '@/modules/auth/application/ports/unit-of-work.port.js'

export function resolveDrizzleClient(db: DrizzleDb, tx: UnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
