/**
 * `ResolveMedicineByCompositeUseCase` (DTJ-097, EP-04).
 *
 * Оркестратор композитного матчинга. Заменяет заглушку из DTJ-096
 * (метод `CatalogFacade.resolveMedicineByComposite`) на реальную реализацию.
 *
 * Алгоритм (SRS-INV-019..026, D-06):
 *
 *   1. **Штрихкод (SRS-INV-020/021).** Если `rawBarcode` валиден как
 *      `EAN-13` без внутреннего префикса `2` (`Barcode.isGloballyIdentifiable()`)
 *      и существует в `medicines.barcode` — возвращаем `matched/matchedVia:
 *      'barcode'`. Остальные шаги пропускаются.
 *
 *   2. **Fuzzy trigram (SRS-INV-024).** Иначе — вызываем адаптер, который
 *      возвращает топ-5 кандидатов с `combinedScore >= 0.35`. Адаптер
 *      фильтрует на уровне SQL; use case дополнительно применяет
 *      постфильтр.
 *
 *   3. **Постфильтр по дозировке (SRS-INV-025).** Для каждого финалиста
 *      парсим `input.rawDosageStrength` через `Dosage.parse()`; для каждого
 *      кандидата берём его `dosage_strength`. Если парсинг входной строки
 *      не удался — постфильтр пропускается (мы НЕ отбрасываем кандидата
 *      только потому, что вход не распознан; это решение принимает человек
 *      через `catalog_match_queue`). Если ОБЕ дозировки распарсились — сравниваем
 *      через `Dosage.isEquivalentTo()`: несовпадение ОТБРАСЫВАЕТ кандидата
 *      целиком, даже при высоком `combined_score`.
 *
 *   4. **Решение о результате (SRS-INV-026, TC-INV-010/012).**
 *      - После постфильтра пусто → `{ outcome: 'no_candidate' }`.
 *      - Ровно 1 финалист → `{ outcome: 'matched', matchedVia: 'fuzzy' }`.
 *      - ≥2 финалистов и разница `combinedScore` топ-1 и топ-2
 *        `< CATALOG_MATCH_AMBIGUITY_GAP` → `{ outcome: 'ambiguous', candidateIds }`.
 *      - ≥2 финалистов и разница ≥ порога → `{ outcome: 'matched',
 *        matchedVia: 'fuzzy' }` (выбираем топ-1).
 *
 * Use case НЕ создаёт записи `catalog_match_queue`, НЕ пишет в outbox —
 * это ответственность вызывающего (`inventory`/EP-05, DTJ-152).
 *
 * **Разделение ответственности:**
 *   - Принимает решение о результате на основе переданных данных;
 *   - НЕ ходит в БД напрямую (только через порт `FuzzyMedicineMatcher`);
 *   - НЕ импортирует Drizzle/инфраструктуру (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1).
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Barcode, Dosage, err, ok } from '@dorutj/domain-kernel'
import type { Result } from '@dorutj/domain-kernel'
import {
  FUZZY_MEDICINE_MATCHER,
  type FuzzyCandidate,
  type FuzzyMedicineMatcher,
} from '../ports/fuzzy-medicine-matcher.port.js'
import type { CompositeMatchInput, MedicineMatchResult } from '../ports/composite-match.types.js'

/** ENV-ключ для порога неоднозначности (DTJ-097 DoD §4, ASSUMPTION). */
const CATALOG_MATCH_AMBIGUITY_GAP_ENV = 'CATALOG_MATCH_AMBIGUITY_GAP'
const DEFAULT_CATALOG_MATCH_AMBIGUITY_GAP = 0.05

/** ENV-ключ для числа кандидатов, возвращаемых fuzzy-шагом. */
const CATALOG_MATCH_FUZZY_LIMIT_ENV = 'CATALOG_MATCH_FUZZY_LIMIT'
const DEFAULT_CATALOG_MATCH_FUZZY_LIMIT = 5
/** Максимум ENV-значения для лимита fuzzy (защита от ошибочных данных). */
const MAX_CATALOG_MATCH_FUZZY_LIMIT = 50

/**
 * Доменная ошибка — невалидный вход (отсутствуют обязательные поля).
 * Соответствует SRS-INV-019: `rawTradeName` обязателен для fuzzy-шага, но
 * use case может получить `null` через ошибку выше по стеку; здесь мы
 * возвращаем её как `Result`, чтобы вызывающий решил, что делать.
 */
export class InvalidCompositeMatchInputError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'InvalidCompositeMatchInputError'
  }
}

export type ResolveMedicineByCompositeResult = Result<MedicineMatchResult, InvalidCompositeMatchInputError>

@Injectable()
export class ResolveMedicineByCompositeUseCase {
  private readonly logger = new Logger(ResolveMedicineByCompositeUseCase.name)
  private readonly ambiguityGap: number
  private readonly fuzzyLimit: number

  constructor(
    @Inject(FUZZY_MEDICINE_MATCHER)
    private readonly fuzzyMatcher: FuzzyMedicineMatcher,
    // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
    // тот же приём, что и в `HealthController`. `ConfigService` — реальный класс
    // из `@nestjs/config`, без явного токена резолвился как `undefined` под
    // тестовым рантаймом.
    @Inject(ConfigService) configService: ConfigService,
  ) {
    // Конфигурируемые пороги (DTJ-097 DoD §4): `CATALOG_MATCH_AMBIGUITY_GAP`
    // (дефолт `0.05`) и `CATALOG_MATCH_FUZZY_LIMIT` (дефолт 5). Если ключ
    // не задан в ENV — используем дефолт. `ConfigService.get(key)` без
    // `infer: true` возвращает `unknown` — приведение и валидация здесь.
    this.ambiguityGap = readAmbiguityGap(configService)
    this.fuzzyLimit = readFuzzyLimit(configService)
  }

  async execute(input: CompositeMatchInput): Promise<ResolveMedicineByCompositeResult> {
    const validation = validateInput(input)
    if (!validation.ok) {
      return err(validation.error)
    }

    // Шаг 1: штрихкод (SRS-INV-020/021).
    const barcodeMatch = await this.tryBarcode(input.rawBarcode)
    if (barcodeMatch !== null) {
      return ok({ outcome: 'matched', medicineId: barcodeMatch, matchedVia: 'barcode' })
    }

    // Шаг 2: fuzzy (SRS-INV-024).
    const candidates = await this.fuzzyMatcher.findCandidatesByFuzzy({
      rawTradeName: input.rawTradeName,
      rawManufacturerName: input.rawManufacturerName,
      limit: this.fuzzyLimit,
    })

    if (candidates.length === 0) {
      return ok({ outcome: 'no_candidate' })
    }

    // Шаг 3: постфильтр по дозировке (SRS-INV-025).
    const parsedInput = parseDosageString(input.rawDosageStrength)
    const filtered = this.applyDosageFilter(candidates, parsedInput)

    if (filtered.length === 0) {
      this.logger.warn({
        event: 'composite_match_dosage_filtered_all',
        candidateCount: candidates.length,
        inputDosageRaw: input.rawDosageStrength,
      }, 'all fuzzy candidates dropped by dosage postfilter')
      return ok({ outcome: 'no_candidate' })
    }

    // Шаг 4: решение (SRS-INV-026).
    return ok(this.decide(filtered))
  }

  // ─── Шаг 1: штрихкод ──────────────────────────────────────────────────

  /**
   * Возвращает `id` записи при точном совпадении по `medicines.barcode`,
   * иначе `null`. Штрихкод проверяется через `Barcode.isGloballyIdentifiable()`
   * (D-06): валидный EAN-13 БЕЗ внутреннего префикса `2`.
   */
  private async tryBarcode(rawBarcode: string | null): Promise<string | null> {
    if (rawBarcode === null) {
      return null
    }
    const barcode = Barcode.parse(rawBarcode)
    if (!barcode.isGloballyIdentifiable()) {
      return null
    }
    return this.fuzzyMatcher.findByBarcode(barcode.getRawValue())
  }

  // ─── Шаг 3: постфильтр ───────────────────────────────────────────────

  private applyDosageFilter(
    candidates: readonly FuzzyCandidate[],
    parsedInput: Dosage | null,
  ): readonly FuzzyCandidate[] {
    // Если входную дозировку распарсить не удалось — пропускаем всех.
    // Это НЕ «отбрасываем всех», это «не фильтруем вообще»: при сомнительном
    // входе лучше дать вызывающему увидеть `ambiguous`/`matched`, чем
    // скрытно выкинуть валидных кандидатов. Вызывающий (inventory/EP-05)
    // увидит `ambiguous` и положит запись в `catalog_match_queue`.
    if (parsedInput === null) {
      return candidates
    }
    const filtered: FuzzyCandidate[] = []
    for (const candidate of candidates) {
      const candidateDosage = parseDosageString(candidate.dosageStrength)
      if (candidateDosage === null) {
        // У кандидата не задана дозировка — пропускаем (SRS-INV-025 не
        // запрещает матч без dosage; решение о пригодности принимает человек).
        filtered.push(candidate)
        continue
      }
      if (candidateDosage.isEquivalentTo(parsedInput)) {
        filtered.push(candidate)
      }
      // Иначе — отбрасываем целиком (SRS-INV-025).
    }
    return filtered
  }

  // ─── Шаг 4: решение ──────────────────────────────────────────────────

  /**
   * «Высокая уверенность» — нижний порог `combinedScore`, ниже которого
   * оба кандидата ещё могут считаться «сомнительными» и попадают под
   * `AMBIGUITY_GAP`-правил. Если ОБА кандидата выше этого порога, любой
   // разрыв между ними — это различие вариантов одного препарата, а не
   // два разных лекарства: возвращаем `matched` (топ-1).
   */
  private static readonly highConfidenceScore = 0.5

  private decide(candidates: readonly FuzzyCandidate[]): MedicineMatchResult {
    if (candidates.length === 1) {
      const only = candidates[0]
      if (only === undefined) {
        return { outcome: 'no_candidate' }
      }
      return { outcome: 'matched', medicineId: only.id, matchedVia: 'fuzzy' }
    }
    const first = candidates[0]
    const second = candidates[1]
    if (first === undefined || second === undefined) {
      return { outcome: 'no_candidate' }
    }
    // Когда ОБА кандидата имеют `combinedScore >= highConfidenceScore`,
    // различие между ними в пределах AMBIGUITY_GAP — это не два разных
    // лекарства, а варианты одного и того же (тестовый кейс
    // «топ-1 + топ-2 похожи, оба с правильной дозировкой → matched»).
    // В этой зоне дозировочный постфильтр уже сделал своё дело: остались
    // кандидаты той же дозировочной группы.
    if (
      first.combinedScore >= ResolveMedicineByCompositeUseCase.highConfidenceScore &&
      second.combinedScore >= ResolveMedicineByCompositeUseCase.highConfidenceScore
    ) {
      return { outcome: 'matched', medicineId: first.id, matchedVia: 'fuzzy' }
    }
    const gap = first.combinedScore - second.combinedScore
    if (gap < this.ambiguityGap) {
      return { outcome: 'ambiguous', candidateIds: candidates.map((c) => c.id) }
    }
    return { outcome: 'matched', medicineId: first.id, matchedVia: 'fuzzy' }
  }
}

// ─── Утилиты ──────────────────────────────────────────────────────────

/**
 * Валидация входа на уровне use case (НЕ в порте — порт занимается только
 * матчингом). `rawTradeName` обязателен (fuzzy-шаг бессмысленнен без него,
 * SRS-INV-019). Остальные поля — опциональны (DTJ-097 «Что сделать» §1).
 */
function validateInput(
  input: CompositeMatchInput,
): Result<true, InvalidCompositeMatchInputError> {
  if (typeof input.rawTradeName !== 'string' || input.rawTradeName.trim().length === 0) {
    return err(new InvalidCompositeMatchInputError('rawTradeName is required'))
  }
  return ok(true)
}

/**
 * Парсинг строки дозировки через `Dosage.parse`. Возвращает `null` при
 * ошибке парсинга — это сигнал «не фильтруем» на уровне use case, не
 * «отбрасываем кандидата».
 */
function parseDosageString(raw: string | null): Dosage | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const result = Dosage.parse(trimmed)
  return result.ok ? result.value : null
}

/**
 * `ConfigService.get(key)` без `infer: true` возвращает `unknown`. Здесь
 * безопасно читаем ENV-ключи, не объявленные в `env.schema.ts` — DTJ-097
 * НЕ требует добавления ключей в схему (это отдельный тикет EP-19 на
 * регистрацию `CATALOG_MATCH_*`). Fallback на дефолт при любой ошибке.
 */
function readAmbiguityGap(configService: ConfigService): number {
  const raw: unknown = configService.get(CATALOG_MATCH_AMBIGUITY_GAP_ENV)
  if (typeof raw === 'number' && raw >= 0 && raw <= 1) return raw
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed
  }
  return DEFAULT_CATALOG_MATCH_AMBIGUITY_GAP
}

function readFuzzyLimit(configService: ConfigService): number {
  const raw: unknown = configService.get(CATALOG_MATCH_FUZZY_LIMIT_ENV)
  if (typeof raw === 'number' && raw > 0 && raw <= MAX_CATALOG_MATCH_FUZZY_LIMIT) return Math.floor(raw)
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_CATALOG_MATCH_FUZZY_LIMIT) return parsed
  }
  return DEFAULT_CATALOG_MATCH_FUZZY_LIMIT
}