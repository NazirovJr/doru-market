/**
 * `CompositeInventoryMatcherService` (EP-05, DTJ-146/147, SRS-INV-019..027, D-06).
 *
 * Реализует composite-матчинг для строк батча в ДВА ЭТАПА:
 *   - `matchBatch()` — ШАГИ 1-2 (DTJ-146): валидация штрихкода, кэш
 *     `pharmacy_sku_mapping`, точное совпадение по глобальному штрихкоду.
 *   - `resolveFuzzyCandidates()` — ШАГИ 3-4 (DTJ-147): trigram fuzzy-поиск
 *     с дозировочным фильтром и защитой от неоднозначности.
 *
 * Стратегия (SRS-INV-020, первое совпадение побеждает):
 *   1. Валидация штрихкода + классификация (`Barcode.parse`, не бросает).
 *   2. Кэш `pharmacy_sku_mapping` (БАТЧЕВЫЙ запрос).
 *   3. Точное совпадение по глобальному штрихкоду (EAN-13 без префикса
 *      `2`) через `CatalogFacade.findMedicineIdsByBarcodes` (БАТЧЕВЫЙ).
 *      Успех → upsert в кэш, `outcome: 'exact_barcode'`.
 *   4. Иначе — `outcome: 'needs_fuzzy'`. Вызывающий use case (DTJ-148)
 *      передаёт их в `resolveFuzzyCandidates` для trigram-поиска.
 *
 * Внутренний префикс `2` (D-06) НЕ участвует в шаге 3 — внутренние
 * штрихкоды аптеки не должны сопоставляться по `medicines.barcode`:
 * иначе разные сети пересекутся по общему внутреннему коду.
 *
 * **Fuzzy-резолюция (DTJ-147, SRS-INV-024..027):**
 *   - Шаг 3: `findFuzzyCandidates` возвращает топ-5 кандидатов на строку.
 *     Кандидаты с `combinedScore < MIN_FUZZY_SCORE = 0.35` (SRS-DB-018)
 *     отбрасываются.
 *   - Шаг 4 (дозировочный фильтр): для каждого кандидата —
 *     `Dosage.parse(candidate.dosageStrength).isEquivalentTo(
 *         Dosage.parse(row.rawDosageStrength))`; несовпадение отбрасывает
 *     кандидата ЦЕЛИКОМ (даже при высоком `combinedScore`, SRS-INV-025).
 *   - Шаг 5 (неоднозначность): если после фильтра остался 1 кандидат
 *     → `matched`; если ≥2 И разрыв топ-1/топ-2 < `AMBIGUITY_GAP = 0.05`
 *     → `unmatched: ambiguous` (защита от ложного авто-выбора,
 *     SRS-INV-026); иначе → `matched` с топ-1.
 *
 * Сервис не пишет в БД напрямую (правило `02` §3): побочный эффект
 * персистенции (запись в `inventory_sync_errors`, `catalog_match_queue`)
 * — ответственность use case (DTJ-148). Здесь только ЧИСТАЯ РЕЗОЛЮЦИЯ
 * + `OutboxPort.append(event)` (SRS-DOM-151) для атомарной
 * outbox-публикации.
 */
import { Barcode } from '@/shared-kernel/domain/value-objects/barcode.vo.js'
import { Dosage } from '@/shared-kernel/domain/value-objects/dosage.vo.js'
import { Inject, Injectable, Optional } from '@nestjs/common'
import {
  PHARMACY_SKU_MAPPING_REPOSITORY,
  type PharmacySkuMappingRepository,
} from '../ports/pharmacy-sku-mapping.repository.port.js'
import {
  CATALOG_FACADE,
  type CatalogFacade,
  type FuzzyCandidate,
  type FuzzyCandidateInput,
} from '../ports/catalog-facade.port.js'
import {
  INVENTORY_OUTBOX,
  type InventoryOutboxPort,
  type UnmatchedInventoryRowEvent,
} from '../ports/inventory-outbox.port.js'

/** Строка входа — сырая из use case (после парсинга VO `InventoryBatchUpsertRow`). */
export interface UnresolvedRowInput {
  readonly rowIndex: number
  readonly internalSku: string
  readonly rawBarcode: string | null
}

/** Строка, переданная в fuzzy-резолюцию (DTJ-147). */
export interface NeedsFuzzyRow extends UnresolvedRowInput {
  readonly rawTradeName: string
  readonly rawDosageForm: string | null
  readonly rawDosageStrength: string | null
  readonly rawManufacturerName: string | null
}

export type MatchResult =
  | {
      readonly row: UnresolvedRowInput
      readonly outcome: 'cached' | 'exact_barcode'
      readonly medicineId: string
    }
  | { readonly row: UnresolvedRowInput; readonly outcome: 'needs_fuzzy' }

export type FuzzyMatchResult =
  | { readonly row: NeedsFuzzyRow; readonly outcome: 'matched'; readonly medicineId: string }
  | {
      readonly row: NeedsFuzzyRow
      readonly outcome: 'unmatched'
      readonly reason: 'no_candidate' | 'ambiguous'
    }

const MIN_FUZZY_SCORE = 0.35
const AMBIGUITY_GAP = 0.05
const MAX_CANDIDATES_PER_ROW = 5

@Injectable()
export class CompositeInventoryMatcherService {
  constructor(
    @Inject(PHARMACY_SKU_MAPPING_REPOSITORY)
    private readonly skuMappingRepository: PharmacySkuMappingRepository,
    @Optional()
    @Inject(CATALOG_FACADE)
    private readonly catalogFacade: CatalogFacade | null,
    @Inject(INVENTORY_OUTBOX) private readonly outbox: InventoryOutboxPort,
  ) {}

  /** ШАГИ 1-2 (DTJ-146). */
  async matchBatch(
    pharmacyId: string,
    rows: readonly UnresolvedRowInput[],
  ): Promise<readonly MatchResult[]> {
    if (rows.length === 0) {
      return []
    }
    const barcodeByRowIndex = this.classifyBarcodes(rows)
    const cached = await this.skuMappingRepository.findManyByPharmacyAndSkus(
      pharmacyId,
      rows.map((row) => row.internalSku),
    )
    const exactMatches = await this.findExactBarcodeMatches(rows, cached, barcodeByRowIndex)
    return this.buildExactResults({
      rows,
      cached,
      barcodeByRowIndex,
      exactMatches,
      pharmacyId,
    })
  }

  /**
   * ШАГИ 3-4 (DTJ-147). Батчевый fuzzy-поиск для ВСЕХ строк с
   * `outcome: 'needs_fuzzy'` — ОДИН вызов `findFuzzyCandidates` на ВСЮ
   * пачку (SRS-INV-052 п.2). Успешные fuzzy-матчи обновляют кэш
   * (`matchedVia='fuzzy_trigram'`, SRS-INV-023). Несматченные строки
   * отправляют `UnmatchedInventoryRowEvent` в outbox (SRS-INV-027).
   */
  async resolveFuzzyCandidates(
    pharmacyId: string,
    rows: readonly NeedsFuzzyRow[],
  ): Promise<readonly FuzzyMatchResult[]> {
    if (rows.length === 0) {
      return []
    }
    const candidatesByIndex = await this.fetchFuzzyCandidates(rows)
    const results: FuzzyMatchResult[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!
      const resolved = this.resolveOneRow(row, candidatesByIndex.get(i) ?? [])
      if (resolved.outcome === 'matched') {
        await this.skuMappingRepository.upsert({
          pharmacyId,
          internalSku: row.internalSku,
          medicineId: resolved.medicineId,
          matchedVia: 'name_fuzzy',
        })
      } else {
        this.outbox.append(this.buildUnmatchedEvent(pharmacyId, row, resolved.reason))
      }
      results.push(resolved)
    }
    return results
  }

  /** ШАГ 1: парсинг `Barcode` для каждой строки (без I/O). */
  private classifyBarcodes(
    rows: readonly UnresolvedRowInput[],
  ): ReadonlyMap<number, Barcode | null> {
    const result = new Map<number, Barcode | null>()
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!
      result.set(row.rowIndex, row.rawBarcode !== null ? Barcode.parse(row.rawBarcode) : null)
    }
    return result
  }

  /** ШАГ 2.2: батчевый запрос `CatalogFacade` для строк без кэша. */
  private async findExactBarcodeMatches(
    rows: readonly UnresolvedRowInput[],
    cached: ReadonlyMap<string, unknown>,
    barcodeByRowIndex: ReadonlyMap<number, Barcode | null>,
  ): Promise<ReadonlyMap<string, string>> {
    if (this.catalogFacade === null) return new Map()
    const candidates: string[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!
      if (cached.has(row.internalSku)) continue
      const barcode = barcodeByRowIndex.get(row.rowIndex)
      if (barcode === undefined || barcode === null) continue
      if (!barcode.isValidEan13() || barcode.isInternalPrefix()) continue
      candidates.push(barcode.rawValue)
    }
    if (candidates.length === 0) return new Map()
    return this.catalogFacade.findMedicineIdsByBarcodes(candidates)
  }

  /** ШАГ 2.3: собрать `MatchResult` + записать успешные точные в кэш. */
  private async buildExactResults(input: {
    readonly rows: readonly UnresolvedRowInput[]
    readonly cached: ReadonlyMap<
      string,
      { readonly medicineId: string; readonly matchedVia: 'barcode' | 'name_fuzzy' | 'manual_resolve' }
    >
    readonly barcodeByRowIndex: ReadonlyMap<number, Barcode | null>
    readonly exactMatches: ReadonlyMap<string, string>
    readonly pharmacyId: string
  }): Promise<readonly MatchResult[]> {
    const results: MatchResult[] = []
    for (let i = 0; i < input.rows.length; i += 1) {
      const row = input.rows[i]!
      const cachedEntry = input.cached.get(row.internalSku)
      if (cachedEntry !== undefined) {
        results.push({ row, outcome: 'cached', medicineId: cachedEntry.medicineId })
        continue
      }
      const barcode = input.barcodeByRowIndex.get(row.rowIndex)
      if (barcode !== undefined && barcode !== null) {
        if (barcode.isValidEan13() && !barcode.isInternalPrefix()) {
          const medicineId = input.exactMatches.get(barcode.rawValue)
          if (medicineId !== undefined) {
            await this.skuMappingRepository.upsert({
              pharmacyId: input.pharmacyId,
              internalSku: row.internalSku,
              medicineId,
              matchedVia: 'barcode',
            })
            results.push({ row, outcome: 'exact_barcode', medicineId })
            continue
          }
        }
      }
      results.push({ row, outcome: 'needs_fuzzy' })
    }
    return results
  }

  /** ШАГ 3: батчевый fuzzy-запрос (если `CatalogFacade` доступен). */
  private async fetchFuzzyCandidates(
    rows: readonly NeedsFuzzyRow[],
  ): Promise<ReadonlyMap<number, readonly FuzzyCandidate[]>> {
    if (this.catalogFacade === null) return new Map()
    const inputs: FuzzyCandidateInput[] = rows.map((row) => ({
      rawTradeName: row.rawTradeName,
      ...(row.rawDosageForm !== undefined ? { rawDosageForm: row.rawDosageForm } : {}),
      ...(row.rawDosageStrength !== undefined ? { rawDosageStrength: row.rawDosageStrength } : {}),
      ...(row.rawManufacturerName !== undefined
        ? { rawManufacturerName: row.rawManufacturerName }
        : {}),
    }))
    return this.catalogFacade.findFuzzyCandidates(inputs)
  }

  /** ШАГИ 4-5: фильтр по `combinedScore` + дозировка + неоднозначность. */
  private resolveOneRow(
    row: NeedsFuzzyRow,
    candidates: readonly FuzzyCandidate[],
  ): FuzzyMatchResult {
    const top = candidates.slice(0, MAX_CANDIDATES_PER_ROW)
    const filtered = top
      .filter((c) => c.combinedScore >= MIN_FUZZY_SCORE)
      .filter((c) => this.dosageEquivalent(row.rawDosageStrength, c.dosageStrength))
    if (filtered.length === 0) {
      return { row, outcome: 'unmatched', reason: 'no_candidate' }
    }
    if (filtered.length === 1) {
      const winner = filtered[0]!
      return { row, outcome: 'matched', medicineId: winner.medicineId }
    }
    const top1 = filtered[0]!
    const top2 = filtered[1]!
    if (top1.combinedScore - top2.combinedScore < AMBIGUITY_GAP) {
      return { row, outcome: 'unmatched', reason: 'ambiguous' }
    }
    return { row, outcome: 'matched', medicineId: top1.medicineId }
  }

  /** Дозировочный фильтр (SRS-INV-025). Несовпадение → false. */
  private dosageEquivalent(rowDosage: string | null, candidateDosage: string): boolean {
    if (rowDosage === null) return true
    const rowResult = Dosage.parse(rowDosage)
    const candidateResult = Dosage.parse(candidateDosage)
    if (!rowResult.ok || !candidateResult.ok) return false
    return rowResult.value.isEquivalentTo(candidateResult.value)
  }

  /** Outbox-событие для несматченной строки (SRS-INV-027, SRS-DOM-151). */
  private buildUnmatchedEvent(
    pharmacyId: string,
    row: NeedsFuzzyRow,
    reason: 'no_candidate' | 'ambiguous',
  ): UnmatchedInventoryRowEvent {
    return {
      eventType: 'inventory.row.unmatched',
      pharmacyId,
      rawRowPayload: {
        internalSku: row.internalSku,
        rawBarcode: row.rawBarcode,
        rawTradeName: row.rawTradeName,
        rawDosageForm: row.rawDosageForm,
        rawDosageStrength: row.rawDosageStrength,
        rawManufacturerName: row.rawManufacturerName,
      },
      reason,
    }
  }
}
