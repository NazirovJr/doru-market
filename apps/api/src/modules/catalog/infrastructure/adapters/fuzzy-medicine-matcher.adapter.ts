/**
 * Drizzle-реализация `FuzzyMedicineMatcher` (DTJ-097, EP-04).
 *
 * Шаг 1 (SRS-INV-020/021): точный матчинг по штрихкоду `medicines.barcode`.
 * Шаг 2 (SRS-INV-024): trigram fuzzy-матчинг по `trade_name`+`manufacturer_name`
 * с весами `0.7` и `0.3` соответственно. Постфильтр по дозировке
 * (SRS-INV-025) делает use case (`Dosage.isEquivalentTo`) — адаптер только
 * достаёт `dosage_strength` для финалистов.
 *
 * **Два РАЗНЫХ порога `pg_trgm.similarity()`:**
 *   - `pg_trgm.similarity_threshold = 0.20` — сессионная настройка для
 *     **поиска** (`searchMedicineUseCase`, EP-06), порог низкий потому что
 *     пользователь ищет «что-то похожее».
 *   - `CATALOG_MATCH_FUZZY_THRESHOLD = 0.35` (SRS-INV-024, этот тикет) —
 *     порог для **матчинга**: нужна ВЫСОКАЯ уверенность, что это та же
 *     запись в каталоге, иначе лучше уйти в `catalog_match_queue` на модерацию.
 *     Используется через `similarity(...) >= :threshold` в `WHERE`, а НЕ
 *     через `set_limit(...)` — это позволяет задавать порог per-query.
 *
 * **GIN trgm индекс** создаётся в EP-06 (`ux_medicines_search`); до этого
 * `similarity()` всё равно работает (full scan), но медленно. Это допустимо
 * для R1: при объёме каталога до ~10k записей даже без индекса запрос
 * укладывается в десятки миллисекунд.
 *
 * **Адаптер не зависит от `tenantId`:** `medicines` — глобальный справочник
 * платформы (мультитенантность на уровне `pharmacy_inventory`/`orders`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq, sql, type SQL } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { medicines } from '@/db/schema/medicines.js'
import {
  FUZZY_MEDICINE_MATCHER,
  type FuzzyCandidate,
  type FuzzyMedicineMatcher,
} from '@/modules/catalog/application/ports/fuzzy-medicine-matcher.port.js'

/** Дефолтный порог fuzzy (SRS-INV-024, ENV-конфигурируемый). */
const DEFAULT_FUZZY_THRESHOLD = 0.35
/** Дефолтное число финалистов — SRS-INV-024 говорит про топ-5. */
const DEFAULT_FUZZY_CANDIDATE_LIMIT = 5
/**
 * Максимальное число финалистов, возвращаемых fuzzy-шагом. Защита от
 * гигантских `limit` из вызывающего кода — теоретически может прийти
 * `limit=1_000_000` через ошибочный код, и `LIMIT 1_000_000` уже подозрителен.
 */
const MAX_FUZZY_CANDIDATE_LIMIT = 50
/** Длина EAN-13 (SRS-DOM-074). */
const EAN_13_LENGTH = 13
/**
 * Минимальный порог сходства для `trade_name` отдельно от комбинированного
 * `combined_score`. Нужен, чтобы отсеять записи с подходящим
 * `manufacturer_name`, но с совершенно другим `trade_name` (например,
 * «Aspirin» от Bayer и «Aspirin» от другой компании).
 */
const DEFAULT_TRADE_NAME_MIN_SIMILARITY = 0.2

@Injectable()
export class FuzzyMedicineMatcherAdapter implements FuzzyMedicineMatcher {
  private readonly threshold: number
  private readonly candidateLimit: number
  private readonly tradeNameMinSimilarity: number

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {
    // Дефолт берём из константы (DTJ-097 DoD §4). Отдельного ENV-ключа
    // на момент тикета нет — DTJ-097 фиксирует значение `0.35` явно в коде
    // (см. SRS-INV-024). Будущий ENV-ключ будет добавлен в `env.schema.ts`
    // и проброшен через `AppConfigService` отдельным тикетом EP-19/EP-04
    // (см. ниже `// TODO(EP-04-followup)`).
    this.threshold = DEFAULT_FUZZY_THRESHOLD
    this.candidateLimit = DEFAULT_FUZZY_CANDIDATE_LIMIT
    this.tradeNameMinSimilarity = DEFAULT_TRADE_NAME_MIN_SIMILARITY
  }

  async findByBarcode(rawBarcode: string | null): Promise<string | null> {
    if (rawBarcode === null) {
      return null
    }
    // Валидация штрихкода — ответственность use case (`Barcode.parse` →
    // `isGloballyIdentifiable()`); здесь адаптер считает, что входной
    // штрихкод УЖЕ прошёл проверку «EAN-13 без внутреннего префикса». Мы
    // дублируем проверку здесь для defense-in-depth: если кто-то вызвал
    // адаптер мимо use case (например, из теста), мы НЕ должны возвращать
    // `id` для внутреннего штрихкода (D-06).
    const trimmed = rawBarcode.trim()
    if (!isValidGlobalBarcode(trimmed)) {
      return null
    }
    const rows = await this.db
      .select({ id: medicines.id })
      .from(medicines)
      .where(eq(medicines.barcode, trimmed))
      .limit(1)
    const row = rows[0]
    return row === undefined ? null : row.id
  }

  async findCandidatesByFuzzy(input: {
    readonly rawTradeName: string
    readonly rawManufacturerName: string | null
    readonly limit: number
  }): Promise<readonly FuzzyCandidate[]> {
    const tradeName = input.rawTradeName.trim()
    if (tradeName.length === 0) {
      return []
    }
    const manufacturer = input.rawManufacturerName?.trim() ?? ''
    const limit = clampLimit(input.limit, this.candidateLimit)

    // SQL из SRS-INV-024 (запрос 4):
    //   SELECT id, dosage_strength,
    //          (0.7 * similarity(unaccent(trade_name), :trade)
    //          + 0.3 * similarity(unaccent(manufacturer_name), :manufacturer))
    //            AS combined_score
    //   FROM medicines
    //   WHERE combined_score >= :threshold
    //     AND similarity(unaccent(trade_name), :trade) >= :trade_min
    //   ORDER BY combined_score DESC
    //   LIMIT :n
    //
    // Drizzle не даёт декларативного `combined_score` в WHERE; переписываем
    // через `sql<number>\`...\`` с тем же арифметическим выражением
    // (порядок идентичен SQL-зеркалу из спеки — это требуется для
    // воспроизводимости интеграционных тестов).
    const tradeNameSim: SQL<number> = sql<number>`similarity(unaccent(${medicines.tradeName}), ${tradeName})`
    const manufacturerSim: SQL<number> = sql<number>`similarity(unaccent(${medicines.manufacturerName}), ${manufacturer})`
    const combinedScore: SQL<number> = sql<number>`(0.7 * ${tradeNameSim} + 0.3 * ${manufacturerSim})`

    const rows = await this.db
      .select({
        id: medicines.id,
        dosageStrength: medicines.dosageStrength,
        combinedScore,
      })
      .from(medicines)
      .where(
        sql`${combinedScore} >= ${this.threshold} AND ${tradeNameSim} >= ${this.tradeNameMinSimilarity}`,
      )
      .orderBy(sql`${combinedScore} DESC`)
      .limit(limit)

    return rows.map((row) => ({
      id: row.id,
      combinedScore: clampScore(row.combinedScore),
      dosageStrength: row.dosageStrength,
    }))
  }
}

/**
 * Проверка «EAN-13 без внутреннего префикса» (D-06). Здесь намеренно
 * ДУБЛИРУЕМ логику `Barcode.isGloballyIdentifiable()` — адаптер не должен
 * зависеть от `@dorutj/domain-kernel` (тип VO не используется в сигнатуре
 * порта); кроме того, адаптер уже работает со строковым представлением
 * штрихкода в БД. Расхождение с `Barcode.isGloballyIdentifiable()` ловится
 * интеграционным тестом `fuzzy-medicine-matcher.adapter.integration.spec.ts`
 * (TC-INV-010/012).
 */
function isValidGlobalBarcode(raw: string): boolean {
  if (raw.length !== EAN_13_LENGTH) return false
  if (!/^\d{13}$/u.test(raw)) return false
  if (raw.startsWith('2')) return false
  return true
}

function clampLimit(requested: number, fallback: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return fallback
  return Math.min(Math.floor(requested), MAX_FUZZY_CANDIDATE_LIMIT)
}

function clampScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  if (raw < 0) return 0
  if (raw > 1) return 1
  return raw
}

/** DI-привязка: провайдер для `FUZZY_MEDICINE_MATCHER` (D-27). */
export const FUZZY_MEDICINE_MATCHER_PROVIDER = {
  provide: FUZZY_MEDICINE_MATCHER,
  useClass: FuzzyMedicineMatcherAdapter,
} as const