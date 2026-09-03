/**
 * Drizzle-реализация записи построчных ошибок батча (EP-05, DTJ-145,
 * SRS-INV-011) в `inventory_sync_errors`.
 *
 * **Почему это НЕ полная `InventorySyncBatchRepository` (класс, а не
 * `implements InventorySyncBatchRepository`):** `inventory_sync_errors.batch_id`
 * — `NOT NULL REFERENCES inventory_sync_batch(id) ON DELETE CASCADE`
 * (миграция 0020) — запись ошибки требует, чтобы батч УЖЕ существовал
 * строкой в реальном Postgres.
 *
 * **ОБНОВЛЕНО — волна 5, блок C (DTJ-154 закрыт).** Блокер, из-за которого
 * этот класс раньше НЕ мог стать продакшен-путём (FK на батч, который
 * существовал только в `InMemoryInventorySyncBatchRepository`), снят:
 * `DrizzleInventorySyncBatchRepository` (`drizzle-inventory-sync-batch.repository.ts`)
 * теперь пишет `inventory_sync_batch` в реальный Postgres И делегирует
 * СЮДА свой `appendErrors(...)` — ровно так, как предполагал TODO(DTJ-154)
 * ниже (оставлен как есть — точный план был выполнен буквально). Этот
 * класс остаётся отдельным DI-провайдером `inventory.module.ts` (не
 * biндингом `INVENTORY_SYNC_BATCH_REPOSITORY` — им стал
 * `DrizzleInventorySyncBatchRepository`, который инжектирует ЭТОТ класс
 * как зависимость), переписывать SQL не потребовалось.
 *
 * TODO(DTJ-154): после Drizzle-персистентности `inventory_sync_batch`
 * (findById/save/createIfNotExists) — включить этот класс как часть
 * полной Drizzle-реализации `InventorySyncBatchRepository` и переключить
 * `INVENTORY_SYNC_BATCH_REPOSITORY` на неё.
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { inventorySyncErrors } from '@/db/schema/inventory-sync-errors.js'
import type { InventorySyncRowError } from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import type { UnitOfWorkTx } from '@/modules/auth/index.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzleInventorySyncErrorsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  /**
   * Батчевый INSERT — один SQL-запрос на весь массив ошибок пачки
   * (SRS-INV-052 п.1: не «по одному в цикле»). Пустой массив — no-op,
   * без обращения к БД.
   *
   * `tx?` (волна 6, self-deadlock пула соединений) — прокидывается сюда из
   * `DrizzleInventorySyncBatchRepository.appendErrors` (см. её JSDoc).
   */
  async appendErrors(errors: readonly InventorySyncRowError[], tx?: UnitOfWorkTx): Promise<void> {
    if (errors.length === 0) {
      return
    }
    const client = resolveDrizzleClient(this.db, tx)
    await client.insert(inventorySyncErrors).values(
      errors.map((error) => ({
        batchId: error.batchId,
        rowIndex: error.rowIndex,
        errorCode: error.errorCode,
        reason: error.reason,
      })),
    )
  }
}
