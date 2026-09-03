/**
 * Drizzle-реализация `InventoryOutboxPort` (EP-05, DTJ-147/152/157, волна 5 блок C).
 *
 * Пишет в ОБЩУЮ таблицу `outbox` (EP-01, DTJ-016, `outbox.schema.ts`), ту же,
 * которую читает `OutboxRelayWorker` — не отдельную inventory-специфичную
 * таблицу (правило 12: не изобретать второй способ). `aggregateId` —
 * `uuid NOT NULL`, поэтому каждое событие маппится на РЕАЛЬНЫЙ UUID-агрегат
 * порта, а не на составной ключ (`InMemoryInventoryOutbox` использует
 * `pharmacyId::internalSku` — валидно для `Map`, но НЕ валидный UUID для
 * колонки `outbox.aggregate_id`):
 *   - `UnmatchedInventoryRowEvent`   → `aggregateId = pharmacyId` (аптека —
 *     реальный агрегат-владелец; sku/barcode остаются в `payload`).
 *   - `FullSyncSessionStuckEvent`    → `aggregateId = fullSyncSessionId`.
 *   - `InventoryBatchQueuedEvent`    → `aggregateId = batchId`.
 *
 * **Fire-and-forget по контракту порта.** `append`/`appendStuckSession`/
 * `appendBatchQueued` объявлены в порте как СИНХРОННЫЕ `void` (вызываются
 * без `await` из `CompositeInventoryMatcherService`/`DetectStuckFullSyncSessionsUseCase`/
 * `InventoryBatchUpdateController` — см. эти файлы). Реальная запись в
 * Postgres неизбежно асинхронна; адаптер запускает `INSERT` и НЕ ждёт его
 * завершения (`void promise.catch(...)`), проглатывая ошибку записи в
 * outbox (best-effort — тот же приём, что `applyTrigramSimilarityThreshold`
 * в `drizzle.provider.ts`). Смена контракта порта на `Promise<void>`
 * задела бы 3 вызывающих файла вне периметра этого блока (block C —
 * персистентность, не редизайн use case'ов) — см. отчёт сдачи, раздел
 * «Найденные чужие проблемы».
 *
 * `hasStuckAlert` — единственный МЕТОД С РЕАЛЬНЫМ ЧТЕНИЕМ (await), поэтому
 * есть теоретическое окно гонки: если `appendStuckSession` ещё не
 * зафлашился в БД к моменту следующего вызова `hasStuckAlert` (соседний
 * прогон watchdog-крона), дедупликация может не сработать. На интервале
 * крона (минуты) это несущественно; в рамках одного прогона порядок
 * вызовов в `DetectStuckFullSyncSessionsUseCase` — сначала `hasStuckAlert`,
 * потом `appendStuckSession` — гонки не создаёт.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gte } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import {
  INVENTORY_OUTBOX,
  type FullSyncSessionStuckEvent,
  type InventoryBatchQueuedEvent,
  type InventoryOutboxPort,
  type UnmatchedInventoryRowEvent,
} from '@/modules/inventory/application/ports/inventory-outbox.port.js'

const MS_PER_MINUTE = 60_000
const STUCK_SESSION_EVENT_TYPE = 'inventory.full_sync_session.stuck'

@Injectable()
export class DrizzleInventoryOutboxAdapter implements InventoryOutboxPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  append(event: UnmatchedInventoryRowEvent): void {
    this.fireAndForget(
      this.db.insert(outbox).values({
        eventType: event.eventType,
        aggregateType: 'inventory_sync_row',
        aggregateId: event.pharmacyId,
        payload: event,
      }),
    )
  }

  appendStuckSession(event: FullSyncSessionStuckEvent): void {
    this.fireAndForget(
      this.db.insert(outbox).values({
        eventType: event.eventType,
        aggregateType: 'inventory_full_sync_session',
        aggregateId: event.fullSyncSessionId,
        payload: event,
      }),
    )
  }

  appendBatchQueued(event: InventoryBatchQueuedEvent): void {
    this.fireAndForget(
      this.db.insert(outbox).values({
        eventType: event.eventType,
        aggregateType: 'inventory_sync_batch',
        aggregateId: event.batchId,
        payload: event,
      }),
    )
  }

  async hasStuckAlert(fullSyncSessionId: string, withinMinutes: number): Promise<boolean> {
    const cutoff = new Date(Date.now() - withinMinutes * MS_PER_MINUTE)
    const rows = await this.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, STUCK_SESSION_EVENT_TYPE),
          eq(outbox.aggregateId, fullSyncSessionId),
          gte(outbox.createdAt, cutoff),
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  /** См. JSDoc файла — порт объявляет `append*` синхронными, запись — best-effort. */
  private fireAndForget(promise: Promise<unknown>): void {
    void promise.catch(() => {
      // Best-effort: outbox-запись — не источник правды для самой операции
      // (батч/матчинг уже применены к моменту вызова append*), а сигнал для
      // асинхронных потребителей (worker/watchdog). Проглатываем ошибку по
      // тому же принципу, что `applyTrigramSimilarityThreshold`
      // (`drizzle.provider.ts`) — не роняем вызывающий синхронный код.
    })
  }
}

export const INVENTORY_OUTBOX_DRIZZLE_PROVIDER = {
  provide: INVENTORY_OUTBOX,
  useClass: DrizzleInventoryOutboxAdapter,
} as const
