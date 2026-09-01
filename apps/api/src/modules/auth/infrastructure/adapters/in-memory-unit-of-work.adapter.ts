/**
 * `InMemoryUnitOfWorkAdapter` (EP-01, DTJ-024) — заглушка UoW для dev/тестов.
 *
 * В Drizzle-режиме `db.transaction(async (tx) => callback(tx))` обеспечивает
 * ACID-семантику и `SELECT ... FOR UPDATE`. В InMemory-режиме Map-операции
 * синхронны и атомарны по однопоточной модели Node.js, поэтому `run` —
 * no-op-прокси: просто выполняет callback, передавая `null` как `tx`
 * (InMemory-репозитории игнорируют `tx`).
 *
 * Это корректно для R1 (песочница без БД, см. STATE-AND-RESUME §5.1).
 * Drizzle-реализация появится, когда БД подключится — будет требовать
 * `DrizzleDb` в конструкторе и оборачивать `callback` в `db.transaction(...)`.
 */
import { Injectable } from '@nestjs/common'
import {
  UNIT_OF_WORK,
  type UnitOfWorkCallback,
  type UnitOfWorkPort,
} from '@/modules/auth/application/ports/unit-of-work.port.js'

@Injectable()
export class InMemoryUnitOfWorkAdapter implements UnitOfWorkPort {
  async run<T>(callback: UnitOfWorkCallback<T>): Promise<T> {
    // InMemory: атомарность через синхронность Map-операций Node.js.
    // callback получает `null` как `tx` — InMemory-репозитории игнорируют `tx`
    // (работают с закрытыми `Map`-полями, не с БД).
    return callback(null)
  }
}

export { UNIT_OF_WORK }
