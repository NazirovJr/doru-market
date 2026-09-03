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
 * `DrizzleDb`-зависимость инжектится извне через токен `DRIZZLE_DB` (см.
 * `drizzle.provider.ts`) — явный `@Inject`, esbuild (vitest) не эмитит
 * `design:paramtypes` (DTJ-001), а без `@Injectable()` на классе Nest вообще не
 * видит метаданных конструктора и тихо создаёт инстанс без аргументов (`db`
 * остаётся `undefined`, не бросая ошибку при бутстрапе).
 *
 * `zeroOutMissing` принимает ОПЦИОНАЛЬНЫЙ `tx` (волна 6, self-deadlock пула
 * соединений, тот же дефект, что чинили в checkout DTJ-231/233) — использует
 * его через `resolveDrizzleClient` (и прокидывает в
 * `findTouchedBatchNumbersForSession`), чтобы zero-out был частью ТОЙ ЖЕ
 * транзакции, что и `IngestInventoryBatchWithMatchingUseCase.execute` (см.
 * её JSDoc).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNotNull, lt, notInArray, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { inventorySyncBatch } from '@/db/schema/inventory-sync-batch.js'
import { inventorySyncRawItems } from '@/db/schema/inventory-sync-raw-items.js'
import { pharmacyInventory } from '@/db/schema/pharmacy-inventory.js'
import type {
  FullSyncCompletionPort,
  ZeroOutMissingInput,
} from '@/modules/inventory/application/ports/full-sync-completion.port.js'
import type { UnitOfWorkTx } from '@/modules/auth/index.js'
import { resolveDrizzleClient } from './drizzle-tx.util.js'

@Injectable()
export class DrizzleFullSyncCompletionAdapter implements FullSyncCompletionPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  /**
   * Шаг 1: собрать `touchedBatchNumbers` — все `batch_number`, которые
   * были применены в любой странице текущей full-sync сессии (читаем
   * из `inventory_sync_raw_items.payload->>'batch_number'`).
   * Возвращает ПУСТОЙ массив, если ни одна страница не применена.
   *
   * **ИСПРАВЛЕНО — волна 5, блок C.** Ключ JSONB был `'batchNumber'`
   * (camelCase) — не совпадал НИ С ОДНОЙ реальной строкой: контроллер
   * (`InventoryBatchUpdateController.rowToPayload`) пишет payload со
   * snake_case-ключами (`batch_number`, как и остальные поля —
   * `internal_sku`, `raw_barcode`, ...). При camelCase-ключе
   * `payload->>'batchNumber'` был `NULL` для каждой строки →
   * `isNotNull(...)` отфильтровывал ВСЁ → `touched` всегда пустой массив →
   * `zeroOutMissing` (см. ниже) пропускал условие `NOT IN (:touched)`
   * ЦЕЛИКОМ и обнулял ВСЕ лоты аптеки старше `fullSyncTimestamp`,
   * ВКЛЮЧАЯ только что применённые в текущей full-sync сессии. Найдено
   * при подключении этого адаптера как активного `FULL_SYNC_COMPLETION`
   * (до волны 5 — `InMemoryFullSyncCompletion`, баг был невидим), не
   * покрыто ни одним тестом до `drizzle-full-sync-completion.adapter.integration.spec.ts`.
   */
  async findTouchedBatchNumbersForSession(
    fullSyncSessionId: string,
    tx?: UnitOfWorkTx,
  ): Promise<readonly string[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select({
        batchNumber: sql<string>`${inventorySyncRawItems.payload}->>'batch_number'`,
      })
      .from(inventorySyncBatch)
      .innerJoin(inventorySyncRawItems, eq(inventorySyncRawItems.batchId, inventorySyncBatch.id))
      .where(
        and(
          eq(inventorySyncBatch.fullSyncSessionId, fullSyncSessionId),
          isNotNull(sql`${inventorySyncRawItems.payload}->>'batch_number'`),
        ),
      )
    const unique = new Set<string>()
    for (const row of rows as readonly { batchNumber: string }[]) {
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
  async zeroOutMissing(input: ZeroOutMissingInput): Promise<{ readonly zeroedLots: number }> {
    const { pharmacyId, fullSyncSessionId, fullSyncTimestamp, tx } = input
    const client = resolveDrizzleClient(this.db, tx)
    const touched = await this.findTouchedBatchNumbersForSession(fullSyncSessionId, tx)
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
    const result = await client
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
