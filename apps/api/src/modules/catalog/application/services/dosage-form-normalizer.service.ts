/**
 * `DosageFormNormalizer` (DTJ-097, EP-04) — чистая функция домена для маппинга
 * свободного текста 1С/Excel (`"таблетки"`, `"табл."`, `"tabs"`, …) в
 * `DosageFormClass` enum (SRS-INV-024).
 *
 * Эта функция упоминается в спецификации `inventory` как «уже существующая,
 * принадлежит catalog» — реализуется здесь впервые. `inventory`/EP-05 будут
 * вызывать её через `CatalogFacade.resolveMedicineByComposite` (этот же тикет)
 * и не дублировать маппинг у себя.
 *
 * **Источник истины — TS-версия.** SQL-зеркало
 * `apps/api/migrations/0007_catalog_normalize_dosage_form_class.sql` используется
 * в `WHERE`-условии fuzzy-матчинга (SRS-INV-024) — производительность запроса
 * на полной таблице `medicines` важна, чем оправдано дублирование. Логика
 * TS-функции и SQL-функции СИНХРОНИЗИРОВАНА — это контролируется parity-тестом
 * `dosage-form-normalizer.parity.spec.ts` (тест-план DTJ-097).
 *
 * **Нет I/O, нет ENV, нет `Date.now()`/`Math.random()`** — функция лежит в
 * `application/services/` (а не `domain/services/`), потому что она
 * обслуживает use case'ы композитного матчинга и формально не является
 * частью `Medicine`-агрегата. `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1 —
 * application может вызывать инфраструктуру, но сам сервис чистый.
 */
import { DosageFormClass } from '../../domain/medicine.enums.js'

/**
 * Маппинг «нормализованная строка → класс формы выпуска». Регистр и пробелы
 * по краям игнорируются на уровне вызывающего (мы храним ключи в нижнем регистре
 * и обрезанными, см. `normalizeAliasKey`). Дубликат SQL-таблицы
 * `catalog_normalize_dosage_form_class` (apps/api/migrations/0007_*.sql) —
 * любые изменения должны вноситься в ОБА места одновременно и проходить
 * parity-тест `dosage-form-normalizer.parity.spec.ts`.
 */
const DOSAGE_FORM_ALIASES: ReadonlyMap<DosageFormClass, readonly string[]> = new Map([
  [
    DosageFormClass.tablet,
    ['таблетки', 'таблетка', 'табл.', 'таб', 'tabs', 'tablets', 'tablet', 'pill', 'pills'],
  ],
  [
    DosageFormClass.capsule,
    ['капсулы', 'капсула', 'капс.', 'caps', 'capsules', 'capsule'],
  ],
  [
    DosageFormClass.syrup,
    ['сироп', 'sir.', 'syrup', 'sirup', 'syrups'],
  ],
  [
    DosageFormClass.injection,
    [
      'ампулы',
      'ампула',
      'инъекция',
      'инъекции',
      'раствор',
      'injection',
      'inj',
      'ampoules',
      'ampoule',
      'solution',
    ],
  ],
  [
    DosageFormClass.ointment,
    ['мазь', 'ointment', 'cream', 'unguentum'],
  ],
  [
    DosageFormClass.drops,
    ['капли', 'drops'],
  ],
  [
    DosageFormClass.inhaler,
    ['ингалятор', 'ингаляторы', 'inhaler', 'inhalers', 'inhalation'],
  ],
  [
    DosageFormClass.suppository,
    ['свечи', 'суппозитории', 'суппозиторий', 'suppository', 'suppositories'],
  ],
])

/** Инвертированный индекс `alias → DosageFormClass` (создаётся лениво, кэшируется модулем). */
const ALIAS_INDEX: ReadonlyMap<string, DosageFormClass> = buildAliasIndex(DOSAGE_FORM_ALIASES)

/** Маркер дефолта при нераспознанном вводе (SRS-INV-024). */
const UNKNOWN_DOSAGE_FORM_CLASS: DosageFormClass = DosageFormClass.other

function buildAliasIndex(
  aliases: ReadonlyMap<DosageFormClass, readonly string[]>,
): ReadonlyMap<string, DosageFormClass> {
  const index = new Map<string, DosageFormClass>()
  for (const [target, aliasList] of aliases) {
    for (const alias of aliasList) {
      index.set(normalizeAliasKey(alias), target)
    }
  }
  return index
}

function normalizeAliasKey(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Канонический список алиасов, экспортируемый для parity-теста и для возможной
 * автогенерации SQL (SRS-INV-024). Порядок вставки в `DOSAGE_FORM_ALIASES`
 * сохраняется — это та же последовательность `WHEN … THEN`, что в SQL.
 */
export function listDosageFormAliases(): ReadonlyMap<DosageFormClass, readonly string[]> {
  return DOSAGE_FORM_ALIASES
}

/**
 * Маппинг свободного текста 1С/Excel в `DosageFormClass`.
 *
 * Контракт:
 *   - `null` или пустая строка → `DosageFormClass.other` (не ошибка — поле
 *     опционально в `CompositeMatchInput`, см. SRS-INV-019).
 *   - Неизвестная форма выпуска → `DosageFormClass.other` (никогда не бросает;
 *     use case композитного матчинга трактует `other` как «форму не учли при
 *     матчинге, проверим только дозировку»).
 *   - Сравнение — без учёта регистра и пробелов по краям, в остальном точное
 *     совпадение с одним из известных алиасов.
 *
 * Эта функция — источник истины для композитного матчинга: SQL-зеркало
 * (`catalog_normalize_dosage_form_class`, 0007_*.sql) синхронизировано с ней
 * и проверяется parity-тестом.
 */
export function catalogNormalizeDosageFormClass(raw: string | null): DosageFormClass {
  if (raw === null) {
    return UNKNOWN_DOSAGE_FORM_CLASS
  }
  const key = normalizeAliasKey(raw)
  if (key.length === 0) {
    return UNKNOWN_DOSAGE_FORM_CLASS
  }
  const match = ALIAS_INDEX.get(key)
  return match ?? UNKNOWN_DOSAGE_FORM_CLASS
}

/**
 * NestJS-провайдер, чтобы use case мог инжектировать нормализатор. Сама
 * функция `catalogNormalizeDosageFormClass` экспортируется отдельно (для
 * unit-теста, который не поднимает DI-граф NestJS). Singleton — функция
 * чистая, состояния не имеет.
 */
export class DosageFormNormalizerService {
  public normalize(raw: string | null): DosageFormClass {
    return catalogNormalizeDosageFormClass(raw)
  }
}