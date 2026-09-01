/**
 * Порт `CatalogFacade` (EP-05, DTJ-146/147, SRS-INV-019/022/024..027).
 *
 * Межмодульный фасад для `inventory → catalog` (`10-domain-model.md` матрица
 * взаимодействий, `'F'` — Facade). EP-05 ЗАВИСИТ от интерфейса, НЕ от
 * прямой таблицы `medicines` (правило `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1).
 *
 * EP-04 (catalog) **реализует** этот порт, конкретные методы
 * `findMedicineIdsByBarcodes` и `findFuzzyCandidates` добавляются в
 * фасад при координации — тикеты DTJ-146/147 явно фиксируют: «если
 * EP-04 к волне 4 не добавил — координировать напрямую». Inventory-сторона
 * описывает ТОЛЬКО контракт, не реализацию.
 */
export const CATALOG_FACADE = Symbol.for('@dorutj/inventory/catalog-facade')

/** Входные данные для fuzzy-поиска одной строки. */
export interface FuzzyCandidateInput {
  readonly rawTradeName: string
  readonly rawDosageForm?: string | null
  readonly rawManufacturerName?: string | null
  /** Дозировка строки — для последующего фильтра кандидатов (шаг 3 DTJ-147). */
  readonly rawDosageStrength?: string | null
}

/** Один кандидат fuzzy-поиска. */
export interface FuzzyCandidate {
  readonly medicineId: string
  /** `trigram.trade_name + 0.5 * trigram.manufacturer_name` (SRS-INV-024). */
  readonly combinedScore: number
  /** Дозировка кандидата — для фильтра шага 3 (SRS-INV-025). */
  readonly dosageStrength: string
}

export interface CatalogFacade {
  /**
   * Батчевый поиск medicines по глобальным штрихкодам (SRS-INV-022).
   * ОДИН запрос на ВСЕ штрихкоды, не по одному в цикле.
   *
   * @param barcodes массив `barcode`-значений (rawValue из `Barcode.parse`)
   * @returns `Map<barcode, medicineId>` — пустая `Map`, если ничего не найдено
   */
  findMedicineIdsByBarcodes(
    barcodes: readonly string[],
  ): Promise<ReadonlyMap<string, string>>

  /**
   * Батчевый trigram fuzzy-поиск (SRS-INV-024, DTJ-147 шаг 3-4).
   * ОДИН пакетный запрос через временную таблицу + `LATERAL JOIN`,
   * не «по одному в цикле» (SRS-INV-052 п.2). SQL на стороне `catalog`,
   * порог — `SRS-DB-018 = 0.35`. Возвращает топ-5 кандидатов на строку.
   *
   * @param rows массив `FuzzyCandidateInput` для fuzzy-поиска
   * @returns `Map<index, candidates[]>` — индексы соответствуют позициям
   *   в `rows`; пустая запись (или отсутствующий ключ) — кандидатов нет
   */
  findFuzzyCandidates(
    rows: readonly FuzzyCandidateInput[],
  ): Promise<ReadonlyMap<number, readonly FuzzyCandidate[]>>
}
