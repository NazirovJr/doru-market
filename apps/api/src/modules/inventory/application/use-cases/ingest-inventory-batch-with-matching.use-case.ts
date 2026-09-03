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
 *   1. Разделить `cmd.rows` на `resolved: true` (готовы к применению) и
 *      `resolved: false` (матчинг через `CompositeInventoryMatcherService`).
 *   2. Загрузить `InventorySyncBatch` по `cmd.batchId`, `markProcessing()`.
 *   3. Для каждой резолвленной строки — найти/создать `PharmacyInventory`
 *      (батчево), применить `applyDelta`. Ошибки валидации → построчные
 *      `inventory_sync_errors(error_code)`.
 *   4. Для `unmatched` — `OutboxPort.append(event)` + `inventory_sync_errors`.
 *   5. Если `isLastPage && syncType=full` — `FullSyncCompletionPort.zeroOutMissing`.
 *   6. `markCompletedFullSuccess()` (0 ошибок) или
 *      `markCompletedPartialSuccess(accepted, rejected)`.
 *
 * **Границы `unitOfWork.run(...)` (волна 6, исправлено — было self-deadlock
 * пула соединений, найдено при исправлении ТОЧНО ТАКОГО ЖЕ дефекта в
 * checkout DTJ-231/233, подтверждено аудитом).** Раньше ВЕСЬ execute() (шаги
 * 1-6 целиком, включая матчинг) шёл `this.uow.run(async () => {...})` —
 * параметр транзакции даже не был назван, ни один из ~7 вызовов репозиториев
 * внутри не получал `tx`, JSDoc при этом утверждал «Всё в одной
 * unitOfWork.run(...)» — ложная гарантия (откат внешней транзакции НЕ
 * откатывал ничего из перечисленного, каждый вызов шёл своим соединением
 * пула). Хуже того: `matchUnresolvedRows` (шаг 1) вызывает
 * `CompositeInventoryMatcherService`, который ходит в `CatalogFacade` —
 * МЕЖМОДУЛЬНЫЙ порт (`catalog`), тянуть его в транзакцию `inventory`
 * архитектурно неверно (та же причина, что в `checkout.use-case.ts::processGroup`,
 * см. её JSDoc за полным разбором). При конкурентной обработке нескольких
 * аптек ≥ `DEFAULT_POOL_MAX` (`infrastructure/database/drizzle.provider.ts`)
 * это тот же self-deadlock: `tx` держит соединение, `CatalogFacade`
 * (и остальные вызовы без `tx`) просят у ТОГО ЖЕ пула ВТОРОЕ — пул исчерпан
 * навсегда, не «медленно».
 *
 * Исправлено ТЕМ ЖЕ приёмом, что checkout: матчинг (шаг 1,
 * `matchUnresolvedRows` — межмодульный `CatalogFacade` + идемпотентный
 * upsert-кэш `PharmacySkuMappingRepository`, не требует атомарности с
 * персистенцией остатков) вынесен ДО `unitOfWork.run`. ВСЁ остальное (шаги
 * 2-6 — загрузка/лок батча, персистенция остатков, построчные ошибки,
 * full-sync zero-out, финальный статус батча) — ОДНА `unitOfWork.run(tx =>
 * ...)`, и КАЖДЫЙ вызов внутри теперь ДЕЙСТВИТЕЛЬНО получает `tx`
 * (`PharmacyInventoryRepository`/`InventorySyncBatchRepository`/
 * `FullSyncCompletionPort` — порты расширены опциональным `tx?`, см. их
 * JSDoc) — атомарность здесь реальна: провал на любом шаге 2-6 откатывает
 * ВСЕ изменения этой персистентной фазы целиком. Доказано
 * `ingest-inventory-race-conditions.integration.spec.ts` (rollback-тест +
 * конкурентный прогон ≥ `DEFAULT_POOL_MAX` без зависаний пула).
 */
import { Inject, Injectable } from '@nestjs/common'
import { CLOCK, type Clock } from '@/shared-kernel/application/ports/clock.port.js'
// `UnitOfWorkPort` идёт через публичный фасад `modules/auth/index.js` (D-27,
// `no-cross-module-deep-import`) — inventory не имеет права импортировать
// внутренности чужого модуля напрямую. Полный перенос порта в
// `shared-kernel/` (он не auth-специфичен) остаётся будущим улучшением,
// не блокером: фасад уже соблюдает границу контекста.
import { UNIT_OF_WORK, type UnitOfWorkPort, type UnitOfWorkTx } from '@/modules/auth/index.js'
import { InventorySyncBatch } from '../../domain/inventory-sync-batch.entity.js'
import type { PharmacyInventory } from '../../domain/pharmacy-inventory.entity.js'
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
  // eslint-disable-next-line max-params -- 6 DI-инъекций, NestJS constructor injection резолвит по позиции; единый options-объект не идиоматичен для Nest DI
  constructor(
    @Inject(PHARMACY_INVENTORY_REPOSITORY)
    private readonly inventoryRepository: PharmacyInventoryRepository,
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    // Явный @Inject(класс): esbuild (vitest) не эмитит `design:paramtypes` — без него Nest
    // падает на компиляции модуля (DTJ-001, тот же паттерн, что в `SearchCacheService` и др.).
    @Inject(CompositeInventoryMatcherService)
    private readonly matcher: CompositeInventoryMatcherService,
    @Inject(FULL_SYNC_COMPLETION)
    private readonly fullSyncCompletion: FullSyncCompletionPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
  ) {}

  async execute(cmd: IngestInventoryBatchCommand): Promise<IngestInventoryBatchResult> {
    // ШАГ 1 — ВНЕ транзакции (см. JSDoc класса, «Границы unitOfWork.run»):
    // матчинг ходит в межмодульный `CatalogFacade` и не требует атомарности
    // с персистенцией остатков ниже.
    const errors: InventorySyncRowError[] = []
    const { resolvedRows, fuzzyRows } = this.splitRows(cmd.rows)
    const matchedFuzzyRows = await this.matchUnresolvedRows({
      batchId: cmd.batchId,
      pharmacyId: cmd.pharmacyId,
      allRows: cmd.rows,
      fuzzyRows,
      errors,
    })
    const allResolved = [...resolvedRows, ...matchedFuzzyRows]
    // ШАГИ 2-6 — ОДНА транзакция: загрузка/лок батча, персистенция остатков,
    // построчные ошибки, full-sync zero-out, финальный статус — атомарно.
    return this.uow.run(async (tx) => {
      const batch = await this.loadBatchOrThrow(cmd.batchId, tx)
      batch.markProcessing()
      const acceptedRows = await this.applyResolvedRows({
        batchId: cmd.batchId,
        pharmacyId: cmd.pharmacyId,
        rows: allResolved,
        errors,
        tx,
      })
      const rejectedRows = errors.length
      await this.recordRowErrors(errors, tx)
      await this.handleFullSyncCompletion(batch, cmd, tx)
      this.finalizeBatchStatus(batch, acceptedRows, rejectedRows)
      await this.syncBatchRepository.save(batch, tx)
      return {
        batchId: batch.id,
        status: rejectedRows === 0 ? 'completed_full_success' : 'completed_partial_success',
        acceptedRows,
        rejectedRows,
      }
    })
  }

  private async loadBatchOrThrow(batchId: string, tx: UnitOfWorkTx): Promise<InventorySyncBatch> {
    const batch = await this.syncBatchRepository.findById(batchId, tx)
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
    for (const row of rows) {
      if (row.resolved && row.resolvedMedicineId !== null) {
        resolvedRows.push(row)
      } else {
        fuzzyRows.push(toNeedsFuzzyRow(row))
      }
    }
    return { resolvedRows, fuzzyRows }
  }

  private async matchUnresolvedRows(input: {
    batchId: string
    pharmacyId: string
    allRows: readonly IngestRowInput[]
    fuzzyRows: readonly NeedsFuzzyRow[]
    errors: InventorySyncRowError[]
  }): Promise<IngestRowInput[]> {
    const { batchId, pharmacyId, allRows, fuzzyRows, errors } = input
    if (fuzzyRows.length === 0) return []
    const exactByIndex = await this.resolveExactMatches(pharmacyId, fuzzyRows)
    const stillFuzzy = fuzzyRows.filter((row) => !exactByIndex.has(row.rowIndex))
    const fuzzyByIndex = await this.resolveFuzzyMatches({ batchId, pharmacyId, stillFuzzy, errors })
    return this.mergeMatchResults({ allRows, fuzzyRows, exactByIndex, fuzzyByIndex })
  }

  /** ШАГ 2 (DTJ-146): точное совпадение по кэшу/штрихкоду — батчево через matcher. */
  private async resolveExactMatches(
    pharmacyId: string,
    fuzzyRows: readonly NeedsFuzzyRow[],
  ): Promise<ReadonlyMap<number, { medicineId: string }>> {
    const initial: UnresolvedRowInput[] = fuzzyRows.map((row) => ({
      rowIndex: row.rowIndex,
      internalSku: row.internalSku,
      rawBarcode: row.rawBarcode,
    }))
    const exactResults = await this.matcher.matchBatch(pharmacyId, initial)
    const exactByIndex = new Map<number, { medicineId: string }>()
    for (const r of exactResults as readonly (
      | { row: UnresolvedRowInput; outcome: 'cached' | 'exact_barcode'; medicineId: string }
      | { row: UnresolvedRowInput; outcome: 'needs_fuzzy' }
    )[]) {
      if (r.outcome !== 'needs_fuzzy') {
        exactByIndex.set(r.row.rowIndex, { medicineId: r.medicineId })
      }
    }
    return exactByIndex
  }

  /** ШАГИ 3-4 (DTJ-147): fuzzy-резолюция оставшихся строк + построчные ошибки для unmatched. */
  private async resolveFuzzyMatches(input: {
    batchId: string
    pharmacyId: string
    stillFuzzy: readonly NeedsFuzzyRow[]
    errors: InventorySyncRowError[]
  }): Promise<ReadonlyMap<number, { medicineId: string } | { reason: 'no_candidate' | 'ambiguous' }>> {
    const { batchId, pharmacyId, stillFuzzy, errors } = input
    const fuzzyResults = await this.matcher.resolveFuzzyCandidates(pharmacyId, stillFuzzy)
    const fuzzyByIndex = new Map<
      number,
      { medicineId: string } | { reason: 'no_candidate' | 'ambiguous' }
    >()
    for (const r of fuzzyResults as readonly (
      | { row: NeedsFuzzyRow; outcome: 'matched'; medicineId: string }
      | { row: NeedsFuzzyRow; outcome: 'unmatched'; reason: 'no_candidate' | 'ambiguous' }
    )[]) {
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
    return fuzzyByIndex
  }

  /** Слияние exact/fuzzy результатов обратно в `IngestRowInput` с `resolvedMedicineId`. */
  private mergeMatchResults(input: {
    allRows: readonly IngestRowInput[]
    fuzzyRows: readonly NeedsFuzzyRow[]
    exactByIndex: ReadonlyMap<number, { medicineId: string }>
    fuzzyByIndex: ReadonlyMap<number, { medicineId: string } | { reason: 'no_candidate' | 'ambiguous' }>
  }): IngestRowInput[] {
    const { allRows, fuzzyRows, exactByIndex, fuzzyByIndex } = input
    const resolved: IngestRowInput[] = []
    for (const row of fuzzyRows) {
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

  private async applyResolvedRows(input: {
    batchId: string
    pharmacyId: string
    rows: readonly IngestRowInput[]
    errors: InventorySyncRowError[]
    tx: UnitOfWorkTx
  }): Promise<number> {
    const { batchId, pharmacyId, rows, errors, tx } = input
    if (rows.length === 0) return 0
    const medicineIds = Array.from(
      new Set(rows.map((row) => row.resolvedMedicineId).filter((id): id is string => id !== null)),
    )
    const aggregatesByMedicineId = await this.inventoryRepository.findOrCreateManyByMedicineIds({
      pharmacyId,
      medicineIds,
    }, tx)
    const now = this.clock.now()
    let accepted = 0
    for (const row of rows) {
      if (this.applyRowDelta({ batchId, row, aggregatesByMedicineId, now, errors })) {
        accepted += 1
      }
    }
    await this.inventoryRepository.saveMany(Array.from(aggregatesByMedicineId.values()), tx)
    return accepted
  }

  /** Один ряд `applyResolvedRows`: aggregate lookup → validation → `applyDelta`. */
  private applyRowDelta(input: {
    batchId: string
    row: IngestRowInput
    aggregatesByMedicineId: ReadonlyMap<string, PharmacyInventory>
    now: Date
    errors: InventorySyncRowError[]
  }): boolean {
    const { batchId, row, aggregatesByMedicineId, now, errors } = input
    if (row.resolvedMedicineId === null) return false
    const aggregate = aggregatesByMedicineId.get(row.resolvedMedicineId)
    if (aggregate === undefined) {
      errors.push(
        buildRowError({ batchId, rowIndex: row.rowIndex, errorCode: 'medicine_not_found', reason: 'aggregate not found' }),
      )
      return false
    }
    const validation = validateRowForDelta(row)
    if (validation !== null) {
      errors.push(buildRowError({ batchId, rowIndex: row.rowIndex, errorCode: validation.code, reason: validation.reason }))
      return false
    }
    const applyResult = aggregate.applyDelta({
      batchNumber: row.batchNumber,
      priceDiram: row.priceDiram,
      quantity: row.quantity,
      expiryDateIso: row.expiresAtIso,
      lastSyncedAt: now,
    })
    if (applyResult.applied) {
      return true
    }
    errors.push(
      buildRowError({ batchId, rowIndex: row.rowIndex, errorCode: 'duplicate_in_batch', reason: 'stale delta (race with newer batch)' }),
    )
    return false
  }

  private async recordRowErrors(errors: readonly InventorySyncRowError[], tx: UnitOfWorkTx): Promise<void> {
    if (errors.length === 0) return
    await this.syncBatchRepository.appendErrors(errors, tx)
  }

  private async handleFullSyncCompletion(
    batch: InventorySyncBatch,
    cmd: IngestInventoryBatchCommand,
    tx: UnitOfWorkTx,
  ): Promise<void> {
    if (cmd.syncType !== 'full') return
    if (!cmd.isLastPage) return
    if (cmd.fullSyncSessionId === null) return
    await this.fullSyncCompletion.zeroOutMissing({
      pharmacyId: batch.pharmacyId,
      fullSyncSessionId: cmd.fullSyncSessionId,
      fullSyncTimestamp: batch.receivedAt,
      tx,
    })
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
