/**
 * Drizzle-реализация `FullSyncCompletionPort` (EP-05, DTJ-151, SRS-INV-041/042).
 *
 * Вызывается из `IngestInventoryBatchWithMatchingUseCase` (DTJ-148, шаг 5)
 * при `syncType='full' && isLastPage=true`. Обнуляет остатки, чей
 * `batch_number` НЕ встретился ни в одной странице текущего
 * `full_sync_session_id` (товар физически закончился/снят с продажи в
 * 1С).
 *
 * **Защита от гонки (SRS-INV-042):** условие
 * `updatedAt < :fullSyncTimestamp` исключает партии, обновлённые
 * дельтой ПОСЛЕ начала снапшота, но применённые ДО его последней
 * страницы. Без этого условия гонка приводит к ложному занулению
 * корректных остатков.
 *
 * `touchedBatchNumbers` читается из БД по `fullSyncSessionId` через
 * `findTouchedBatchNumbersForSession()` (тикет DTJ-151 явно требует
 * «читать из БД, не из памяти» при многостраничных сессиях с
 * параллельными job'ами воркера).
 *
 * Партии НЕ удаляются физически — только `quantity=0` (аудит/история,
 * тот же принцип, что просроченные партии, SRS-DB-020).
 *
 * `DrizzleDb`-зависимость инжектится извне (см. `drizzle.provider.ts`).
 */
import { and, eq, isNotNull, lt, notInArray, sql } from 'drizzle-orm'
import { inventorySyncBatch } from '@/db/schema/inventory-sync-batch.js'
import { inventorySyncRawItems } from '@/db/schema/inventory-sync-raw-items.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import type { FullSyncCompletionPort } from '../../application/ports/full-sync-completion.port.js'

/** Минимальный контракт Drizzle, который мы используем. */
interface DrizzleLike {
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: ReturnType<typeof and>) => {
        returning: (cols: { quantity: unknown }) => Promise<readonly unknown[]>
      }
    }
  }
  select: (cols: unknown) => {
    from: (table: unknown) => {
      innerJoin: (
        b: unknown,
        cond: ReturnType<typeof eq>,
      ) => {
        where: (cond: ReturnType<typeof and>) => Promise<readonly { batchNumber: string }[]>
      }
    }
  }
}

export class DrizzleFullSyncCompletionAdapter implements FullSyncCompletionPort {
  constructor(private readonly db: DrizzleLike) {}

  /**
   * Шаг 1: собрать `touchedBatchNumbers` — все `batch_number`, которые
   * были применены в любой странице текущей full-sync сессии (читаем
   * из `inventory_sync_raw_items.payload->>'batchNumber'`).
   * Возвращает ПУСТОЙ массив, если ни одна страница не применена.
   */
  async findTouchedBatchNumbersForSession(
    fullSyncSessionId: string,
  ): Promise<readonly string[]> {
    const rows = await this.db
      .select({
        batchNumber: sql<string>`${inventorySyncRawItems.payload}->>'batchNumber'`,
      })
      .from(inventorySyncBatch)
      .innerJoin(inventorySyncRawItems, eq(inventorySyncRawItems.batchId, inventorySyncBatch.id))
      .where(
        and(
          eq(inventorySyncBatch.fullSyncSessionId, fullSyncSessionId),
          isNotNull(sql`${inventorySyncRawItems.payload}->>'batchNumber'`),
        ),
      )
    const unique = new Set<string>()
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] as { batchNumber: string }
      if (row.batchNumber.length > 0) {
        unique.add(row.batchNumber)
      }
    }
    return Array.from(unique)
  }

  /**
   * ШАГ 2: обнулить партии, не упомянутые в `touchedBatchNumbers`,
   * с защитой от гонки (SRS-INV-042).
   */
  async zeroOutMissing(
    pharmacyId: string,
    fullSyncSessionId: string,
    fullSyncTimestamp: Date,
  ): Promise<{ readonly zeroedLots: number }> {
    const touched = await this.findTouchedBatchNumbersForSession(fullSyncSessionId)
    // Условия (SRS-INV-041/042):
    //   - `pharmacy_id = :pharmacyId` — только эта аптека;
    //   - `updatedAt < :fullSyncTimestamp` — партии, обновлённые
    //     РАНЬШЕ начала снапшота; гонка с дельтой, применённой во время
    //     снапшота, НЕ затрагивается (см. SRS-INV-042);
    //   - `batchNumber NOT IN (:touched)` — НЕ обнуляем партии, чей
    //     `batch_number` встретился в снапшоте (иначе — ложное зануление
    //     только что применённых строк);
    //   - `quantity > 0` — идемпотентность: повторный запуск не считает
    //     уже-нулевые партии повторно (zeroedLots — это число реально
    //     изменённых строк, см. `.returning()`).
    const conditions = [
      eq(pharmacyInventory.pharmacyId, pharmacyId),
      lt(pharmacyInventory.updatedAt, fullSyncTimestamp),
      sql`${pharmacyInventory.quantity} > 0`,
    ]
    if (touched.length > 0) {
      conditions.push(notInArray(pharmacyInventory.batchNumber, touched as string[]))
    }
    const result = await this.db
      .update(pharmacyInventory)
      .set({
        quantity: 0,
        // `updatedAt` обнуляется моментом снапшота, чтобы при следующей
        // гонке не переприменить дельту поверх нуля.
        updatedAt: fullSyncTimestamp,
      })
      .where(and(...conditions))
      .returning({ quantity: pharmacyInventory.quantity })
    return { zeroedLots: result.length }
  }
}
