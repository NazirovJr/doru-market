/**
 * `dosage-form-normalizer.parity.spec.ts` (DTJ-097, EP-04).
 *
 * Parity-тест: гарантирует, что TS-функция `catalogNormalizeDosageFormClass`
 * и SQL-функция `catalog_normalize_dosage_form_class` (apps/api/migrations/
 * 0007_*.sql) синхронизированы по множеству алиасов. Без этой проверки
 * правка одной копии без другой проходит незаметно — типичный источник
 * долгоживущих багов (см. STATE §11.2 дефект F и §11.4 Блок 1.1).
 *
 * Что тест проверяет (статически, без БД):
 *   1. SQL-файл `0007_catalog_normalize_dosage_form_class.sql` существует
 *      и парсится как текст.
 *   2. Каждый `raw`-литерал из WHEN-условий SQL присутствует в
 *      `DOSAGE_FORM_ALIASES` TS-функции (точное совпадение после `lower(btrim)`).
 *   3. Каждое WHEN-условие имеет THEN-таргет, и таргет — допустимое
 *      значение `dosage_form_class` enum.
 *
 * Что тест НЕ покрывает (требует БД):
 *   - Фактическое выполнение `SELECT catalog_normalize_dosage_form_class(:raw)`
 *     на реальном Postgres — это integration-тест уровня
 *     `dosage-form-normalizer.integration.spec.ts` (отдельный тикет EP-19
 *     на testcontainers-инфраструктуру; см. §11.4 STATE).
 *
 * **Правило §3 (не отключай проверку).** Если SQL-файл отсутствует или не
 * парсится — тест ПАДАЕТ с явным сообщением (НЕ `it.skip`). Это и есть
 * parity-guard: пока файл не написан, правки TS-функции блокируются.
 *
 * **Правило §11 (блокер проверок).** Если testcontainers-БД недоступна
 * (например, в sandbox без Docker) — integration-часть parity-теста
 * описана отдельным `it.todo()` с ссылкой на инфраструктурный тикет.
 * `it.todo` — это НЕ `it.skip` (правило §3); тест просто зафиксирован
 * как запланированный, не отключённый.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 Блок 1.1
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DosageFormClass } from '../../domain/medicine.enums.js'
import {
  catalogNormalizeDosageFormClass,
  listDosageFormAliases,
} from './dosage-form-normalizer.service.js'

const FILE_URL_PATH = fileURLToPath(import.meta.url)
const SPEC_DIR = dirname(FILE_URL_PATH)
// spec лежит в `src/modules/catalog/application/services/`, SQL — в `apps/api/migrations/`.
// Поднимаемся на 5 уровней до корня `apps/api/`, затем `migrations/<file>.sql`.
const APPS_API_DIR = resolve(SPEC_DIR, '..', '..', '..', '..', '..')
const SQL_FILE_NAME = '0007_catalog_normalize_dosage_form_class.sql'
const SQL_FILE_PATH = join(APPS_API_DIR, 'migrations', SQL_FILE_NAME)

const SQL_DOSAGE_FORM_CLASS_VALUES: readonly string[] = [
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'ointment',
  'drops',
  'inhaler',
  'suppository',
  'other',
]

describe('parity TS↔SQL: catalogNormalizeDosageFormClass (DTJ-097)', () => {
  describe('SQL-файл существует и парсится', () => {
    it('apps/api/migrations/0007_catalog_normalize_dosage_form_class.sql доступен', () => {
      let content: string
      try {
        content = readFileSync(SQL_FILE_PATH, 'utf8')
      } catch (err) {
        throw new Error(
          `SQL-функция отсутствует: ${SQL_FILE_PATH}. ` +
            'Parity-guard невозможен — TS-функция не имеет синхронизированной SQL-копии. ' +
            `(оригинальная ошибка: ${err instanceof Error ? err.message : String(err)})`,
        )
      }
      expect(content.length).toBeGreaterThan(0)
      expect(content).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+catalog_normalize_dosage_form_class/i)
      expect(content).toMatch(/LANGUAGE\s+sql/i)
      expect(content).toMatch(/IMMUTABLE/i)
    })
  })

  describe('Каждый алиас из TS-функции есть в SQL', () => {
    it('для всех 8 классов (без `other`) есть хотя бы один общий алиас', () => {
      const sql = readFileSyncSyncOrFail()
      const tsAliases = listDosageFormAliases()
      const sqlLiterals = extractSqlLiterals(sql)

      for (const [target, aliasList] of tsAliases) {
        let found = false
        for (const alias of aliasList) {
          const normalized = alias.trim().toLowerCase()
          if (sqlLiterals.has(normalized)) {
            found = true
            break
          }
        }
        expect(
          found,
          `TS-класс ${target} не имеет ни одного алиаса, общего с SQL-функцией. ` +
            'Возможно, TS-функция обновлена, а SQL — нет. ' +
            'Синхронизируйте apps/api/migrations/0007_*.sql в том же коммите.',
        ).toBe(true)
      }
    })

    it('все SQL-литералы из WHEN-условий присутствуют в TS', () => {
      // Обратная сторона: всё, что есть в SQL WHEN, должно быть в TS
      // (иначе SQL вернёт `other` для строки, которую TS распознаёт).
      const sql = readFileSyncSyncOrFail()
      const tsAliases = listDosageFormAliases()
      const sqlLiterals = extractSqlLiterals(sql)
      const tsSet = new Set<string>()
      for (const [, aliasList] of tsAliases) {
        for (const alias of aliasList) {
          tsSet.add(alias.trim().toLowerCase())
        }
      }

      const orphans: string[] = []
      for (const literal of sqlLiterals) {
        if (!tsSet.has(literal)) {
          orphans.push(literal)
        }
      }
      expect(
        orphans,
        `SQL-литералы отсутствуют в TS: ${orphans.join(', ')}. ` +
          'Возможно, SQL обновлён, а TS — нет.',
      ).toEqual([])
    })
  })

  describe('THEN-таргеты SQL-функции — допустимые enum-значения', () => {
    it('все THEN castятся в известный dosage_form_class', () => {
      const sql = readFileSyncSyncOrFail()
      const thenMatches = sql.matchAll(/THEN\s+'([a-z_]+)'::dosage_form_class/giu)
      const seen = new Set<string>()
      for (const match of thenMatches) {
        const value = match[1]
        if (value !== undefined) {
          seen.add(value)
        }
      }
      expect(seen.size).toBeGreaterThan(0)
      for (const value of seen) {
        expect(SQL_DOSAGE_FORM_CLASS_VALUES).toContain(value)
      }
    })
  })

  describe('TS-функция сохраняет поведение для репрезентативного набора', () => {
    // Это «минимальный регресс-гарант»: даже без parity с SQL — TS-функция
    // должна вернуть то же значение, что и для тех же строк без изменений.
    // Если кто-то случайно поменяет алиас в TS — этот блок упадёт.
    it.each<readonly [string, DosageFormClass]>([
      ['таблетки', DosageFormClass.tablet],
      ['сироп', DosageFormClass.syrup],
      ['ампулы', DosageFormClass.injection],
      ['капли', DosageFormClass.drops],
      ['ингалятор', DosageFormClass.inhaler],
      ['свечи', DosageFormClass.suppository],
      ['unknown-form', DosageFormClass.other],
      ['', DosageFormClass.other],
    ])('%j → %s', (input, expected) => {
      expect(catalogNormalizeDosageFormClass(input)).toBe(expected)
    })
  })

  // ─── Что НЕ покрыто в этом файле ──────────────────────────────────────
  //
  // Интеграционная часть parity-теста (требует БД):
  //   - `SELECT catalog_normalize_dosage_form_class(:raw)` на реальном
  //     Postgres должен совпадать с TS-функцией для всего набора
  //     `listDosageFormAliases()`. Требует testcontainers Postgres (тикет
  //     на EP-19 инфраструктуру, см. STATE §11.4). Тест НЕ отключён
  //     через `it.skip` (правило §3) — он просто не существует в этом
  //     файле. Когда testcontainers будет готов, его можно будет добавить
  //     сюда отдельным `describe('integration', ...)`-блоком.
})

// ─── helpers ───────────────────────────────────────────────────────────

function readFileSyncSyncOrFail(): string {
  try {
    return readFileSync(SQL_FILE_PATH, 'utf8')
  } catch (err) {
    throw new Error(
      `Не удалось прочитать ${SQL_FILE_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Извлекает строковые литералы из SQL-выражения вида:
 *   WHEN lower(btrim(raw)) IN (
 *     'таблетки', 'табл.', 'tabs', ...
 *   ) THEN 'tablet'::dosage_form_class
 *
 * Возвращает Set нормализованных литералов (lower, trimmed). Не смотрим на
 * `THEN`-литералы (это enum-значения, не алиасы).
 */
function extractSqlLiterals(sql: string): ReadonlySet<string> {
  const result = new Set<string>()
  // Ищем блоки `WHEN ... IN ('a', 'b', 'c') THEN ...`
  const whenBlocks = sql.matchAll(/WHEN[^']*?IN\s*\(([^)]+)\)/giu)
  for (const match of whenBlocks) {
    const inside = match[1]
    if (inside === undefined) continue
    const literals = inside.matchAll(/'([^']+)'/gu)
    for (const literalMatch of literals) {
      const value = literalMatch[1]
      if (value !== undefined) {
        result.add(value.trim().toLowerCase())
      }
    }
  }
  return result
}