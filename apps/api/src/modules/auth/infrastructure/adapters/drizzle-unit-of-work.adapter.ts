/**
 * `DrizzleUnitOfWorkAdapter` (EP-01, DTJ-024, волна 5 блок A) — production-реализация
 * `UnitOfWorkPort` через `db.transaction(...)` (`drizzle-orm/node-postgres`).
 *
 * Оборачивает callback в реальную Postgres-транзакцию: репозитории, получившие
 * `tx`, обязаны использовать ЕГО (не `this.db`) для своих запросов —
 * `SELECT ... FOR UPDATE` (`DrizzleOtpCodesRepository.findByIdForUpdate`)
 * и последующие `UPDATE` внутри того же callback видят согласованное
 * состояние и держат блокировку строки до commit/rollback (SRS-API-071).
 *
 * `NodePgTransaction`, который прокидывает `db.transaction`, присваивается
 * `UnitOfWorkTx` (`= unknown`) без потерь — обратное приведение к
 * конкретному Drizzle-типу происходит в `resolveDrizzleClient`
 * (`drizzle-tx.util.ts`), которым пользуются Drizzle-репозитории этого модуля.
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import {
  UNIT_OF_WORK,
  type UnitOfWorkCallback,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'

@Injectable()
export class DrizzleUnitOfWorkAdapter implements UnitOfWorkPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async run<T>(callback: UnitOfWorkCallback<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx))
  }
}

export { UNIT_OF_WORK }
