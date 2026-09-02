/**
 * Маппер `RestInventoryRequest → IngestInventoryBatchCommand` (EP-05, DTJ-157, SRS-INV-011).
 *
 * Чистая функция, тестируется отдельно. Вход — DTO после Zod-парсинга
 * (типизированный как `InventoryBatchUpdateRequest`); выход — DTO для
 * use case'а. Конвертация `price_diram` (number из JSON, дирамы) уже
 * присутствует во входе — никаких `fromDbDecimalTjs` тут нет, это
 * ответственность вызывающей стороны на границе (SRS-INV-011).
 */
import type { InventoryBatchUpdateRequest } from '@dorutj/contracts'
import type { IngestInventoryBatchCommand } from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'
import type { IngestRowInput } from '@/modules/inventory/application/use-cases/ingest-inventory-batch-with-matching.use-case.js'

export function toCommand(
  dto: InventoryBatchUpdateRequest,
  principalPharmacyId: string,
  // `now` принимается для будущего использования (R2: deterministic timestamps в команде).
  // В R1 команда не несёт `now` — время берёт use case через `Clock` (DTJ-001).
  _now: Date,
): IngestInventoryBatchCommand {
  const rows: IngestRowInput[] = dto.items.map((item, index) => ({
    rowIndex: index,
    internalSku: item.internal_sku,
    rawBarcode: item.raw_barcode ?? null,
    rawTradeName: item.raw_trade_name,
    rawDosageForm: item.raw_dosage_form ?? null,
    rawDosageStrength: item.raw_dosage_strength ?? null,
    rawManufacturerName: item.raw_manufacturer_name ?? null,
    priceDiram: BigInt(item.price_diram),
    quantity: item.quantity,
    expiresAtIso: item.expires_at,
    batchNumber: item.batch_number ?? null,
    // REST-канал передаёт «сырые» строки — резолвинг medicine_id
    // выполняет matcher в use case'е (DTJ-146/147).
    resolved: false,
    resolvedMedicineId: null,
  }))
  return {
    batchId: dto.batch_id,
    // Guard' уже прокинул `pharmacyId` в principal — это ЕДИНСТВЕННЫЙ
    // источник правды. DTO-`pharmacyId` НЕ читаем (даже если он там
    // был бы), иначе — chainId-scope-check обходится.
    pharmacyId: principalPharmacyId,
    syncType: dto.sync_type,
    fullSyncSessionId: dto.full_sync_session_id ?? null,
    // Zod `.default(true)` гарантирует непустое значение после парсинга —
    // `?? true` было мёртвым кодом (тип `is_last_page` в выходе не optional).
    isLastPage: dto.is_last_page,
    rows,
  }
}

export const RestInventoryRequestToCommandMapper = { toCommand }
