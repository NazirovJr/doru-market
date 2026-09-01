/**
 * `IngestInventoryBatchWithMatchingUseCase` (EP-05, DTJ-148, SRS-INV-001/010/056).
 *
 * Единая точка входа ВСЕХ каналов приёма остатков (D-12). Это НОВЫЙ use
 * case, идущий ПАРАЛЛЕЛЬНО с устаревшим `IngestInventoryBatchUseCase` (плоский
 * путь R1-бутстрапа, работает через `repository.upsertMany` напрямую).
 * Миграция существующего use case и контроллера — DTJ-157/DTJ-161; здесь
 * полная FSM-интеграция (DTJ-144) + composite-матчинг (DTJ-146/147) +
 * entity-персистенция (DTJ-143).
 *
 * **Алгоритм (шаги 1-6, по тикету):**
 *   1. Загрузить `InventorySyncBatch` по `cmd.batchId`, `markProcessing()`.
 *   2. Разделить `cmd.rows` на `resolved: true` (готовы к применению) и
 *      `resolved: false` (матчинг через `CompositeInventoryMatcherService`).
 *   3. Для каждой резолвленной строки — найти/создать `PharmacyInventory`
 *      (батчево), применить `applyDelta`. Ошибки валидации → построчные
 *      `inventory_sync_errors(error_code)`.
 *   4. Для `unmatched` — `OutboxPort.append(event)` + `inventory_sync_errors`.
 *   5. Если `isLastPage && syncType=full` — `FullSyncCompletionPort.zeroOutMissing`.
 *   6. `markCompletedFullSuccess()` (0 ошибок) или
 *      `markCompletedPartialSuccess(accepted, rejected)`.
 *
 * Всё в одной `unitOfWork.run(...)` (правило `02` §3 п.3).
 */
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
// `UnitOfWorkPort` идёт через публичный фасад `modules/auth/index.js` (D-27,
// `no-cross-module-deep-import`) — inventory не имеет права импортировать
// внутренности чужого модуля напрямую. Полный перенос порта в
// `shared-kernel/` (он не auth-специфичен) остаётся будущим улучшением,
// не блокером: фасад уже соблюдает границу контекста.
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/modules/auth/index.js'
import { InventorySyncBatch } from '../../domain/inventory-sync-batch.entity.js'
import {
  PHARMACY_INVENTORY_REPOSITORY,
  type PharmacyInventoryRepository,
} from '../ports/pharmacy-inventory.repository.port.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
  type InventorySyncRowError,
} from '../ports/inventory-sync-batch.repository.port.js'
import {
  FULL_SYNC_COMPLETION,
  type FullSyncCompletionPort,
} from '../ports/full-sync-completion.port.js'
import {
  CompositeInventoryMatcherService,
  type NeedsFuzzyRow,
  type UnresolvedRowInput,
} from '../services/composite-inventory-matcher.service.js'
import {
  buildRowError,
  toNeedsFuzzyRow,
  validateRowForDelta,
  type IngestRowInput,
} from './ingest-inventory-batch.helpers.js'

// Re-export: внешние потребители (controller, mapper, spec) продолжают
// импортировать `IngestRowInput` отсюда — тип теперь ОПРЕДЕЛЁН в
// `ingest-inventory-batch.helpers.js` (разрывает цикл use-case ↔ helpers,
// depcruise `no-circular`), но публичная точка входа не меняется.
export type { IngestRowInput }

export interface IngestInventoryBatchCommand {
  readonly batchId: string
  readonly pharmacyId: string
  readonly syncType: 'delta' | 'full'
  readonly fullSyncSessionId: string | null
  readonly isLastPage: boolean
  readonly rows: readonly IngestRowInput[]
}

export interface IngestInventoryBatchResult {
  readonly batchId: string
  readonly status: 'completed_full_success' | 'completed_partial_success'
  readonly acceptedRows: number
  readonly rejectedRows: number
}

@Injectable()
export class IngestInventoryBatchWithMatchingUseCase {
  constructor(
    @Inject(PHARMACY_INVENTORY_REPOSITORY)
    private readonly inventoryRepository: PharmacyInventoryRepository,
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    private readonly matcher: CompositeInventoryMatcherService,
    @Inject(FULL_SYNC_COMPLETION)
    private readonly fullSyncCompletion: FullSyncCompletionPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  async execute(cmd: IngestInventoryBatchCommand): Promise<IngestInventoryBatchResult> {
    return this.uow.run(async () => {
      const batch = await this.loadBatchOrThrow(cmd.batchId)
      batch.markProcessing()
      const errors: InventorySyncRowError[] = []
      const { resolvedRows, fuzzyRows } = this.splitRows(cmd.rows)
      const matchedFuzzyRows = await this.matchUnresolvedRows(
        cmd.batchId,
        cmd.pharmacyId,
        cmd.rows,
        fuzzyRows,
        errors,
      )
      const allResolved = [...resolvedRows, ...matchedFuzzyRows]
      const acceptedRows = await this.applyResolvedRows(
        cmd.batchId,
        cmd.pharmacyId,
        allResolved,
        errors,
      )
      const rejectedRows = errors.length
      await this.recordRowErrors(errors)
      await this.handleFullSyncCompletion(batch, cmd)
      this.finalizeBatchStatus(batch, acceptedRows, rejectedRows)
      await this.syncBatchRepository.save(batch)
      return {
        batchId: batch.id,
        status: rejectedRows === 0 ? 'completed_full_success' : 'completed_partial_success',
        acceptedRows,
        rejectedRows,
      }
    })
  }

  private async loadBatchOrThrow(batchId: string): Promise<InventorySyncBatch> {
    const batch = await this.syncBatchRepository.findById(batchId)
    if (batch === null) {
      throw new Error(`InventorySyncBatch ${batchId} not found`)
    }
    return batch
  }

  private splitRows(rows: readonly IngestRowInput[]): {
    readonly resolvedRows: IngestRowInput[]
    readonly fuzzyRows: NeedsFuzzyRow[]
  } {
    const resolvedRows: IngestRowInput[] = []
    const fuzzyRows: NeedsFuzzyRow[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!
      if (row.resolved && row.resolvedMedicineId !== null) {
        resolvedRows.push(row)
      } else {
        fuzzyRows.push(toNeedsFuzzyRow(row))
      }
    }
    return { resolvedRows, fuzzyRows }
  }

  private async matchUnresolvedRows(
    batchId: string,
    pharmacyId: string,
    allRows: readonly IngestRowInput[],
    fuzzyRows: readonly NeedsFuzzyRow[],
    errors: InventorySyncRowError[],
  ): Promise<IngestRowInput[]> {
    if (fuzzyRows.length === 0) return []
    const initial: UnresolvedRowInput[] = fuzzyRows.map((row) => ({
      rowIndex: row.rowIndex,
      internalSku: row.internalSku,
      rawBarcode: row.rawBarcode,
    }))
    const exactResults = await this.matcher.matchBatch(pharmacyId, initial)
    const exactByIndex = new Map<number, { medicineId: string }>()
    for (let i = 0; i < exactResults.length; i += 1) {
      const r = exactResults[i] as
        | { row: UnresolvedRowInput; outcome: 'cached' | 'exact_barcode'; medicineId: string }
        | { row: UnresolvedRowInput; outcome: 'needs_fuzzy' }
      if (r.outcome !== 'needs_fuzzy') {
        exactByIndex.set(r.row.rowIndex, { medicineId: r.medicineId })
      }
    }
    const stillFuzzy = fuzzyRows.filter((row) => !exactByIndex.has(row.rowIndex))
    const fuzzyResults = await this.matcher.resolveFuzzyCandidates(pharmacyId, stillFuzzy)
    const fuzzyByIndex = new Map<
      number,
      { medicineId: string } | { reason: 'no_candidate' | 'ambiguous' }
    >()
    for (let i = 0; i < fuzzyResults.length; i += 1) {
      const r = fuzzyResults[i] as
        | { row: NeedsFuzzyRow; outcome: 'matched'; medicineId: string }
        | { row: NeedsFuzzyRow; outcome: 'unmatched'; reason: 'no_candidate' | 'ambiguous' }
      if (r.outcome === 'matched') {
        fuzzyByIndex.set(r.row.rowIndex, { medicineId: r.medicineId })
      } else {
        errors.push({
          batchId,
          rowIndex: r.row.rowIndex,
          errorCode: 'unmatched_medicine',
          reason: `unmatched: ${r.reason}`,
        })
        fuzzyByIndex.set(r.row.rowIndex, { reason: r.reason })
      }
    }
    const resolved: IngestRowInput[] = []
    for (let i = 0; i < fuzzyRows.length; i += 1) {
      const row = fuzzyRows[i]!
      const sourceRow = allRows.find((r) => r.rowIndex === row.rowIndex)
      if (sourceRow === undefined) continue
      const exactHit = exactByIndex.get(row.rowIndex)
      const fuzzyHit = fuzzyByIndex.get(row.rowIndex)
      const medicineId =
        exactHit?.medicineId ??
        (fuzzyHit !== undefined && 'medicineId' in fuzzyHit ? fuzzyHit.medicineId : null)
      if (medicineId !== null) {
        resolved.push({ ...sourceRow, resolved: true, resolvedMedicineId: medicineId })
      }
    }
    return resolved
  }

  private async applyResolvedRows(
    batchId: string,
    pharmacyId: string,
    rows: readonly IngestRowInput[],
    errors: InventorySyncRowError[],
  ): Promise<number> {
    if (rows.length === 0) return 0
    const medicineIds = Array.from(
      new Set(
        rows
          .map((row) => row.resolvedMedicineId)
          .filter((id): id is string => id !== null),
      ),
    )
    const aggregatesByMedicineId = await this.inventoryRepository.findOrCreateManyByMedicineIds({
      pharmacyId,
      medicineIds,
    })
    let accepted = 0
    const now = this.clock.now()
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!
      if (row.resolvedMedicineId === null) continue
      const aggregate = aggregatesByMedicineId.get(row.resolvedMedicineId)
      if (aggregate === undefined) {
        errors.push(buildRowError(batchId, row.rowIndex, 'medicine_not_found', 'aggregate not found'))
        continue
      }
      const validation = validateRowForDelta(row)
      if (validation !== null) {
        errors.push(buildRowError(batchId, row.rowIndex, validation.code, validation.reason))
        continue
      }
      const applyResult = aggregate.applyDelta({
        batchNumber: row.batchNumber,
        priceDiram: row.priceDiram,
        quantity: row.quantity,
        expiryDateIso: row.expiresAtIso,
        lastSyncedAt: now,
      })
      if (applyResult.applied) {
        accepted += 1
      } else {
        errors.push(
          buildRowError(batchId, row.rowIndex, 'duplicate_in_batch', 'stale delta (race with newer batch)'),
        )
      }
    }
    await this.inventoryRepository.saveMany(Array.from(aggregatesByMedicineId.values()))
    return accepted
  }

  private async recordRowErrors(errors: readonly InventorySyncRowError[]): Promise<void> {
    if (errors.length === 0) return
    await this.syncBatchRepository.appendErrors(errors)
  }

  private async handleFullSyncCompletion(
    batch: InventorySyncBatch,
    cmd: IngestInventoryBatchCommand,
  ): Promise<void> {
    if (cmd.syncType !== 'full') return
    if (!cmd.isLastPage) return
    if (cmd.fullSyncSessionId === null) return
    await this.fullSyncCompletion.zeroOutMissing(
      batch.pharmacyId,
      cmd.fullSyncSessionId,
      batch.receivedAt,
    )
  }

  private finalizeBatchStatus(
    batch: InventorySyncBatch,
    acceptedRows: number,
    rejectedRows: number,
  ): void {
    if (rejectedRows === 0) {
      batch.markCompletedFullSuccess()
      return
    }
    batch.markCompletedPartialSuccess(acceptedRows, rejectedRows, this.clock.now())
  }
}
