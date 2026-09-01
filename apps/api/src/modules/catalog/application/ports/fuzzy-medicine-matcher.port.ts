/**
 * Порт `FuzzyMedicineMatcher` (DTJ-097, EP-04).
 *
 * `resolveMedicineByComposite` (DTJ-097) делает три вещи:
 *   1. Точный матчинг по штрихкоду (EAN-13) → 1 SQL.
 *   2. Fuzzy trigram-матчинг по тексту + дозировке → 1 SQL + постфильтр.
 *   3. Решение о неоднозначности / отсутствии кандидата.
 *
 * Адаптер инфраструктуры (`FuzzyMedicineMatcherAdapter`) реализует шаги 1-2
 * через `DrizzleDb`; use case НЕ знает про Drizzle и SQL — только про этот
 * порт (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1).
 *
 * Почему отдельный порт, а не метод `CatalogRepository`?
 *   - Репозиторий оперирует `MedicineRecord` (DTO инфраструктуры), а fuzzy-
 *     матчер возвращает ОЦЕНКУ релевантности (`combinedScore`) + идентификатор
 *     кандидата. Это другой контракт.
 *   - Fuzzy-логика может развиваться (синонимы, веса, дополнительные источники
 *     для SRS-INV-026) — изолируем в отдельный порт, чтобы не раздувать
 *     `CatalogRepository`.
 */

/**
 * Один кандидат, найденный fuzzy-матчингом (SRS-INV-024/025). Реальный
 * доменный объект не возвращается — use case использует `id` и `combinedScore`
 * для ранжирования; полный `MedicineRecord` подгружается вторым шагом только
 * для финалистов (SRS-INV-025 — постфильтр по дозировке).
 */
export interface FuzzyCandidate {
  readonly id: string
  /** `0.7 × trade_name + 0.3 × manufacturer_name` (SRS-INV-024). Диапазон `[0, 1]`. */
  readonly combinedScore: number
  /**
   * Денормализованное поле `dosage_strength` для постфильтра (SRS-INV-025).
   * `null` если у кандидата не задано — постфильтр пропускает.
   */
  readonly dosageStrength: string | null
}

/** DI-токен NestJS для `FuzzyMedicineMatcher` (D-27: единый Symbol на пакет). */
export const FUZZY_MEDICINE_MATCHER = Symbol.for('@dorutj/catalog/fuzzy-medicine-matcher')

/**
 * Контракт порта (DTJ-097).
 *
 * Методы возвращают сырых кандидатов (топ-5) или лучший штрихкод-матч, чтобы
 * use case мог применить постфильтр (`Dosage.isEquivalentTo`) ДО решения
 * `matched`/`ambiguous`/`no_candidate`. Это разделение ответственности:
 * адаптер НЕ решает про дозировку — он только достаёт данные (SRS-INV-024).
 * Решение о результате принимает use case (SRS-INV-025/026, TC-INV-010/012).
 */
export interface FuzzyMedicineMatcher {
  /**
   * Шаг 1 — точное совпадение по штрихкоду (SRS-INV-020/021).
   *
   * - `rawBarcode` не задан / невалидный EAN-13 / внутренний префикс `2`
   *   (D-06) → возвращает `null` (use case идёт к шагу 2).
   * - Штрихкод валидный, но отсутствует в `medicines.barcode` → `null`.
   * - Найден → возвращает `id` записи.
   *
   * Метод НЕ возвращает полный `MedicineRecord` — только id. Если в дальнейшем
   * понадобится полная запись для штрихкод-матча, use case сделает отдельный
   * вызов `CatalogRepository.findMedicineById(id)`.
   */
  findByBarcode(rawBarcode: string | null): Promise<string | null>

  /**
   * Шаг 2 — trigram fuzzy-матчинг (SRS-INV-024, запрос 4).
   *
   * `rawTradeName` обязателен (use case передаёт пустую строку только если
   * хочет явно показать «пусто», и в этом случае адаптер возвращает пустой
   * массив — fuzzy по пустому тексту бессмысленнен).
   *
   * Возвращает топ-`limit` кандидатов с `combinedScore >= FUZZY_THRESHOLD`
   * (SRS-INV-024: порог `0.35`, константа из `AppConfigService`). Если ниже
   * порога никого нет — пустой массив.
   */
  findCandidatesByFuzzy(input: {
    readonly rawTradeName: string
    readonly rawManufacturerName: string | null
    readonly limit: number
  }): Promise<readonly FuzzyCandidate[]>
}