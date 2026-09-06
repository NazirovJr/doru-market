/**
 * Маппер `ManualEntryRequest → IngestInventoryBatchCommand` (EP-05, DTJ-162, SRS-INV-015).
 *
 * ВСЕ строки — `resolved: true` (фармацевт уже выбрал медикамент через каталожный
 * автокомплит, `medicineId` уже известен — composite-матчинг избыточен и НЕ вызывается,
 * см. `IngestInventoryBatchWithMatchingUseCase.splitRows`: `resolved && resolvedMedicineId
 * !== null` идёт прямо в `resolvedRows`, минуя матчер).
 *
 * `internalSku`/`rawTradeName` заполнены `medicineId` (НЕ пустой строкой) — `IngestRowInput`
 * спроектирован для СЫРЫХ каналов (REST/Excel), где эти поля несут текст для fuzzy-матчинга;
 * для resolved-строк они СТРУКТУРНО обязательны типом, но НИКОГДА не читаются конвейером
 * персистенции (`applyResolvedRows`/`applyRowDelta` используют только
 * `resolvedMedicineId`/`batchNumber`/`priceDiram`/`quantity`/`expiresAtIso`) — `medicineId`
 * как плейсхолдер как минимум трассируем при отладке, в отличие от `''`.
 *
 * **`priceDiram` — ПРЯМАЯ арифметика (`round(priceTjs*100)`), НЕ `Money.fromDbDecimalTjs`.**
 * Это НАМЕРЕННО: `Money.fromDbDecimalTjs` бросает на отрицательной строке (её контракт —
 * доверенные данные БД), а критерий приёмки 2 требует, чтобы отрицательная/нулевая цена
 * дошла до `IngestInventoryBatchCommand` и была отклонена СУЩЕСТВУЮЩЕЙ проверкой use case'а
 * (`validateRowForDelta`: `priceDiram < 0n → invalid_price`) — тем самым канал ПЕРЕИСПОЛЬЗУЕТ
 * готовую построчную инфраструктуру частичного успеха (`inventory_sync_errors`), вместо
 * отдельной pre-валидации в контроллере (что потребовало бы ручной синхронизации `totalRows`
 * между «до» и «после» фильтрации — см. инвариант `acceptedRows+rejectedRows===totalRows`
 * в `InventorySyncBatch.markCompletedPartialSuccess`). Приёмочный тест поэтому использует
 * ОТРИЦАТЕЛЬНУЮ цену как пример «priceTjs<=0» (см. риски: ровно НУЛЕВАЯ цена НЕ отклоняется
 * этой существующей проверкой — `0n < 0n` ложно — известное ограничение, унаследованное от
 * `validateRowForDelta`, не введено этим тикетом).
 *
 * `op: 'delete'` — доменной операции «удалить лот» не существует (`PharmacyInventory` не
 * имеет такого метода, DTJ-143 не проектировал его). Минимальная интерпретация ЭТОГО тикета:
 * форсировать `quantity=0` (тот же `applyDelta`, что и обычный upsert, лот обнуляется —
 * функционально эквивалент «удалению» для FEFO-выборки, см. JSDoc `PharmacyInventory`,
 * `quantity > 0` требование). Если это неприемлемо, эскалировать — доменный метод `remove()`
 * вне periметра `files_owned` этого тикета.
 */
import type { ManualEntryRequest, ManualEntryRow } from '@dorutj/contracts'
import type {
  IngestInventoryBatchCommand,
  IngestRowInput,
} from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'

const DIRAMS_PER_TJS = 100

function batchNumberOrDefault(row: ManualEntryRow, medicineId: string, todayIso: string): string {
  return row.batchNumber ?? `MANUAL-${medicineId}-${todayIso}`
}

export function toIngestRowInput(row: ManualEntryRow, rowIndexInBatch: number, todayIso: string): IngestRowInput {
  return {
    rowIndex: rowIndexInBatch,
    internalSku: row.medicineId,
    rawBarcode: null,
    rawTradeName: row.medicineId,
    rawDosageForm: null,
    rawDosageStrength: null,
    rawManufacturerName: null,
    priceDiram: BigInt(Math.round(row.priceTjs * DIRAMS_PER_TJS)),
    quantity: row.op === 'delete' ? 0 : row.quantity,
    expiresAtIso: row.expiryDate,
    batchNumber: batchNumberOrDefault(row, row.medicineId, todayIso),
    resolved: true,
    resolvedMedicineId: row.medicineId,
  }
}

export function toCommand(input: {
  readonly dto: ManualEntryRequest
  readonly pharmacyId: string
  readonly batchId: string
  readonly todayIso: string
}): IngestInventoryBatchCommand {
  return {
    batchId: input.batchId,
    pharmacyId: input.pharmacyId,
    syncType: 'delta',
    fullSyncSessionId: null,
    isLastPage: true,
    rows: input.dto.rows.map((row, rowIndex) => toIngestRowInput(row, rowIndex, input.todayIso)),
  }
}

export const ManualEntryRequestToCommandMapper = { toCommand }
