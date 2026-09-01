/**
 * `IngestInventoryBatchUseCase` (EP-05, DTJ-148) — единая точка входа для всех
 * трёх каналов приёма остатков: `manual` (UI), `excel` (Excel/CSV upload),
 * `rest` (1С/ERP REST).
 *
 * Контроллер передаёт СЫРЫЕ данные (`IngestInventoryBatchRowInput`). Use case
 * маппит их в `InventoryBatchUpsertRow` (валидация — здесь). Это соблюдает
 * чистую архитектуру: presentation НЕ импортирует domain (правило
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1).
 *
 * Контракт:
 *   - `pharmacyId` — UUID активной аптеки. Проверка активности (suspended/revoked)
 *     — на стороне вызывающего (middleware) или в use case (TODO: вызов
 *     `OnboardingFacade.getPharmacyStatus(pharmacyId)` после DTJ-070).
 *   - `rows` — НЕпустой массив. Пустой массив → `EmptyInventoryBatchError`.
 *   - `now` — время для валидации `expiresAt > now` (FEFO-инвариант).
 */
import { Inject, Injectable } from '@nestjs/common'
import { InventoryBatchUpsertRow } from '../../domain/value-objects/inventory-batch-upsert-row.vo.js'
import { type InventorySyncChannel } from '../../domain/inventory-sync.types.js'

export type { InventorySyncChannel } from '../../domain/inventory-sync.types.js'
import { EmptyInventoryBatchError } from '../../domain/errors/inventory.errors.js'
import {
  PHARMACY_INVENTORY_REPOSITORY,
  type PharmacyInventoryRepository,
} from '../ports/pharmacy-inventory.repository.port.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from '../ports/inventory-sync-batch.repository.port.js'

/** Сырые данные строки из контроллера. Маппинг в VO — внутри use case. */
export interface IngestInventoryBatchRowInput {
  readonly medicineId: string
  readonly barcode: string | null
  readonly price: number
  readonly quantity: number
  readonly expiresAt: string
  readonly batchNumber: string | null
}

export interface IngestInventoryBatchInput {
  readonly pharmacyId: string
  readonly channel: InventorySyncChannel
  readonly rows: readonly IngestInventoryBatchRowInput[]
  readonly now: Date
  readonly note: string | null
}

export interface IngestInventoryBatchResult {
  readonly batchId: string
  readonly acceptedRows: number
  readonly updatedRows: number
  readonly rejectedRows: number
  readonly errors: readonly { readonly rowIndex: number; readonly reason: string }[]
}

@Injectable()
export class IngestInventoryBatchUseCase {
  constructor(
    @Inject(PHARMACY_INVENTORY_REPOSITORY)
    private readonly inventoryRepository: PharmacyInventoryRepository,
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
  ) {}

  async execute(input: IngestInventoryBatchInput): Promise<IngestInventoryBatchResult> {
    if (input.rows.length === 0) {
      throw new EmptyInventoryBatchError()
    }
    const { validatedRows, errors } = this.validateRows(input.rows, input.now)
    if (validatedRows.length === 0) {
      return this.persistFailedBatch(input, errors)
    }
    const upsert = await this.inventoryRepository.upsertMany({
      pharmacyId: input.pharmacyId,
      rows: validatedRows,
    })
    const batch = await this.syncBatchRepository.create({
      pharmacyId: input.pharmacyId,
      channel: input.channel,
      totalRows: input.rows.length,
      acceptedRows: upsert.acceptedCount,
      rejectedRows: errors.length,
      errorSummary: errors,
      note: input.note,
    })
    if (errors.length > 0) {
      await this.syncBatchRepository.markStatus(batch.id, 'failed_validation')
    }
    return {
      batchId: batch.id,
      acceptedRows: upsert.acceptedCount,
      updatedRows: upsert.updatedCount,
      rejectedRows: errors.length,
      errors,
    }
  }

  private validateRows(
    rows: readonly IngestInventoryBatchRowInput[],
    now: Date,
  ): {
    readonly validatedRows: InventoryBatchUpsertRow[]
    readonly errors: { rowIndex: number; reason: string }[]
  } {
    const validatedRows: InventoryBatchUpsertRow[] = []
    const errors: { rowIndex: number; reason: string }[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i]
      if (raw === undefined) {
        continue
      }
      const result = InventoryBatchUpsertRow.create(
        {
          medicineId: raw.medicineId,
          barcode: raw.barcode,
          price: raw.price,
          quantity: raw.quantity,
          expiresAt: raw.expiresAt,
          batchNumber: raw.batchNumber,
        },
        now,
      )
      if (result.ok) {
        validatedRows.push(result.value)
        continue
      }
      errors.push({ rowIndex: i, reason: result.error.message })
    }
    return { validatedRows, errors }
  }

  private async persistFailedBatch(
    input: IngestInventoryBatchInput,
    errors: readonly { rowIndex: number; reason: string }[],
  ): Promise<IngestInventoryBatchResult> {
    const batch = await this.syncBatchRepository.create({
      pharmacyId: input.pharmacyId,
      channel: input.channel,
      totalRows: input.rows.length,
      acceptedRows: 0,
      rejectedRows: errors.length,
      errorSummary: errors,
      note: input.note,
    })
    await this.syncBatchRepository.markStatus(batch.id, 'failed_validation')
    return {
      batchId: batch.id,
      acceptedRows: 0,
      updatedRows: 0,
      rejectedRows: errors.length,
      errors,
    }
  }
}
