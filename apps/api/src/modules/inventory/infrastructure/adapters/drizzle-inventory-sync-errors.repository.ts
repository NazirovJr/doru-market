/**
 * Drizzle-реализация записи построчных ошибок батча (EP-05, DTJ-145,
 * SRS-INV-011) в `inventory_sync_errors`.
 *
 * **Почему это НЕ полная `InventorySyncBatchRepository` (класс, а не
 * `implements InventorySyncBatchRepository`) и НЕ продакшен-биндинг
 * `INVENTORY_SYNC_BATCH_REPOSITORY`:**
 *
 * `inventory_sync_errors.batch_id` — `NOT NULL REFERENCES
 * inventory_sync_batch(id) ON DELETE CASCADE` (миграция 0020). Запись
 * ошибки требует, чтобы батч УЖЕ существовал строкой в реальном Postgres.
 * Сегодня `createIfNotExists`/`save`/`findById` (FSM-агрегат) реализованы
 * ТОЛЬКО in-memory (`InMemoryInventorySyncBatchRepository`) — Drizzle-версия
 * этой части порта числится за DTJ-154 и ещё не написана.
 *
 * Если бы этот адаптер стал продакшен-биндингом `INVENTORY_SYNC_BATCH_REPOSITORY`
 * целиком (или хотя бы для `appendErrors`) ДО DTJ-154, каждый реальный вызов
 * `POST /inventory/batch-update` начал бы падать: `appendErrors` пытался бы
 * вставить строку с `batch_id`, которого в реальной `inventory_sync_batch`
 * физически нет (она создана только в памяти) → FK-violation → откат ВСЕЙ
 * `unitOfWork.run(...)` транзакции `IngestInventoryBatchWithMatchingUseCase`.
 * Это не «частично применили батч, ошибки видно в кабинете» (цель DTJ-145),
 * а «уронили 100% ранее хоть как-то работавших запросов» — регресс хуже
 * текущего дефекта.
 *
 * Поэтому `INVENTORY_SYNC_BATCH_REPOSITORY` в `inventory.module.ts` остаётся
 * на `InMemoryInventorySyncBatchRepository` (сознательное решение, см. отчёт
 * DTJ-145). Этот класс — самостоятельный, готовый компонент: как только
 * DTJ-154 даст реальную персистентность батча, `appendErrors` в Drizzle-версии
 * порта делегирует сюда БЕЗ переписывания SQL.
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

@Injectable()
export class DrizzleInventorySyncErrorsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  /**
   * Батчевый INSERT — один SQL-запрос на весь массив ошибок пачки
   * (SRS-INV-052 п.1: не «по одному в цикле»). Пустой массив — no-op,
   * без обращения к БД.
   */
  async appendErrors(errors: readonly InventorySyncRowError[]): Promise<void> {
    if (errors.length === 0) {
      return
    }
    await this.db.insert(inventorySyncErrors).values(
      errors.map((error) => ({
        batchId: error.batchId,
        rowIndex: error.rowIndex,
        errorCode: error.errorCode,
        reason: error.reason,
      })),
    )
  }
}
