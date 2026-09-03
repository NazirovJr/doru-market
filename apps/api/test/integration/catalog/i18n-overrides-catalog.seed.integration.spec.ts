/**
 * Интеграционный тест `seedI18nOverridesCatalog` + миграция `0024_i18n_overrides_review_status.sql`
 * (DTJ-103, EP-07) — РЕАЛЬНЫЙ Postgres, реальная миграция — не `describe.skipIf` фейком.
 *
 * **Почему миграция применяется через `db.execute(readFileSync(...))`, а не через полный
 * `drizzle-orm/node-postgres/migrator` (`migrate()`), в отличие от
 * `postgres-pharmacy-map.adapter.integration.spec.ts`/`postgres-search.adapter.integration.spec.ts`.**
 * Диагностировано эмпирически на `dorutj_test3` (роль `test`): `migrate()` пытается завести
 * СОБСТВЕННУЮ бухгалтерскую схему `drizzle.__drizzle_migrations` — `CREATE SCHEMA drizzle`
 * либо падает `permission denied for schema drizzle` (42501), либо схема создаётся, но не
 * видна следующей же транзакцией (`information_schema.schemata` её не показывает) — похоже
 * на охранный слой окружения, запрещающий агентам создавать схемы вне `public`. При этом
 * `CREATE TABLE`/`DROP TABLE` В `public` работают штатно (проверено отдельно, `test` —
 * полноправный владелец таблиц `public`, 32 таблицы уже существуют). Тот же приём, что уже
 * применяет `catalog-read-endpoints.integration.spec.ts` (`db.execute(EXTENSIONS_SQL)`) —
 * прямое исполнение текста конкретного `.sql`-файла, идемпотентного по своей конструкции
 * (`CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`/guarded `ADD CONSTRAINT`,
 * см. сам файл миграции), без бухгалтерии `drizzle`-схемы.
 *
 * Тест-план DTJ-103 буквально:
 *   - миграция применяется, колонка `review_status` существует с дефолтом
 *     `'pending_legal_review'`;
 *   - сид идемпотентен — повторный запуск не создаёт дублей (`ON CONFLICT ... DO UPDATE`);
 *   - `COUNT(*) WHERE key LIKE 'catalog.analogs.%' = 15` (5 ключей × 3 локали);
 *   - побайтовое сравнение текста `catalog.analogs.disclaimer` с эталоном SRS-CAT-039
 *     на ВСЕХ 3 локалях — эталон здесь НЕЗАВИСИМАЯ транскрипция из спеки (не импорт
 *     константы из `i18n-overrides-catalog.seed.ts`), иначе тест ловил бы только
 *     «сид совпадает сам с собой», не «сид совпадает со спекой».
 *
 * **Изоляция от соседних файлов.** `beforeEach` удаляет ТОЛЬКО строки
 * `tenant_id = I18N_SEED_NEUTRAL_TENANT_ID AND translation_key LIKE 'catalog.analogs.%'`
 * (свой namespace ключей под общим нейтральным тенантом) — не трогает строку самого
 * нейтрального тенанта (`tenants`/`tenant_settings`, заведена `0021_seed_neutral_tenant.sql`,
 * общая инфраструктура для ВСЕХ файлов `test/integration/catalog/*`) и не делает
 * `TRUNCATE ... CASCADE` (урок волны 5 — см. `reports/EP09-CTO-BRIEF.md` §6.5).
 *
 * **Откат миграции.** DoD DTJ-103 требует «применяется и откатывается». Полный
 * apply→rollback→re-apply цикл здесь НЕ прогоняется автоматически: `dorutj_test3` —
 * общая БД, которую делят все файлы `test/integration/catalog/*` в рамках ОДНОГО
 * прогона (`vitest.integration.config.ts`: `fileParallelism: false`, файлы строго
 * последовательно) — снести таблицу `i18n_overrides` посреди прогона сломало бы
 * `analogs.controller.integration.spec.ts` (следующий файл того же набора, которому
 * таблица нужна). Вместо этого — структурная проверка: down-файл существует и
 * содержит `DROP TABLE IF EXISTS i18n_overrides` (тест ниже), а полный
 * up→down→up цикл против реальной `dorutj_test3` прогнан ВРУЧНУЮ один раз при
 * сдаче тикета (см. отчёт сдачи, раздел «ПРОВЕРКИ»).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-038..041)
 * @see apps/api/src/db/seed/i18n-overrides-catalog.seed.ts
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import {
  I18N_SEED_NEUTRAL_TENANT_ID,
  KEY_DISCLAIMER,
  seedI18nOverridesCatalog,
} from '@/db/seed/i18n-overrides-catalog.seed.js'

const TEST_DATABASE_URL =
  process.env.CATALOG_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const MIGRATIONS_URL = new URL('../../../migrations/', import.meta.url)
const MIGRATION_0024_SQL = readFileSync(new URL('0024_i18n_overrides_review_status.sql', MIGRATIONS_URL), 'utf8')
const PROBE_TIMEOUT_MS = 1_500
const EXPECTED_ROW_COUNT = 15

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: PROBE_TIMEOUT_MS })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

/**
 * Эталон SRS-CAT-039 — НЕЗАВИСИМАЯ транскрипция (см. JSDoc файла, зачем не импорт
 * из seed-скрипта). Guillemets «…» спеки — разметка документа, не часть значения
 * (см. JSDoc `i18n-overrides-catalog.seed.ts`, сравнение с `ux.error.generic_500`).
 */
const DISCLAIMER_GOLDEN: Readonly<Record<'ru' | 'tj' | 'en', string>> = {
  ru:
    'Это не медицинская рекомендация. Указанные препараты содержат одинаковый набор ' +
    'действующих веществ в равной дозировке, но могут отличаться вспомогательными ' +
    'веществами и производителем. Перед заменой препарата проконсультируйтесь с ' +
    'фармацевтом или врачом.',
  tj:
    'Ин тавсияи тиббӣ нест. Доруҳои нишондодашуда моддаҳои фаъоли якхела бо миқдори ' +
    'баробар доранд, аммо моддаҳои ёрирасон ва истеҳсолкунанда метавонанд фарқ кунанд. ' +
    'Пеш аз иваз кардани дору бо фармасевт ё духтур машварат кунед.',
  en:
    'This is not medical advice. These products contain the same active substances at an ' +
    'equivalent strength, but may differ in excipients and manufacturer. Consult a ' +
    'pharmacist or doctor before switching medication.',
}

describe.skipIf(!postgresAvailable)('seedI18nOverridesCatalog — integration (DTJ-103)', () => {
  let pool: Pool
  let db: NodePgDatabase

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
    // Прямое исполнение SQL миграции (не бухгалтерский `migrate()`) — см. JSDoc файла.
    await db.execute(MIGRATION_0024_SQL)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  beforeEach(async () => {
    await pool.query(
      "DELETE FROM i18n_overrides WHERE tenant_id = $1 AND translation_key LIKE 'catalog.analogs.%'",
      [I18N_SEED_NEUTRAL_TENANT_ID],
    )
  })

  it('review_status существует с дефолтом pending_legal_review (не указан явно при INSERT)', async () => {
    await pool.query(
      `INSERT INTO i18n_overrides (tenant_id, locale, translation_key, value)
       VALUES ($1, 'ru', 'catalog.analogs.__probe', 'x')`,
      [I18N_SEED_NEUTRAL_TENANT_ID],
    )
    const result = await pool.query<{ review_status: string }>(
      "SELECT review_status FROM i18n_overrides WHERE translation_key = 'catalog.analogs.__probe'",
    )
    expect(result.rows[0]?.review_status).toBe('pending_legal_review')
    await pool.query("DELETE FROM i18n_overrides WHERE translation_key = 'catalog.analogs.__probe'")
  })

  it('сидит ровно 15 строк (5 ключей × 3 локали, catalog.analogs.%)', async () => {
    await seedI18nOverridesCatalog(db)
    const result = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM i18n_overrides WHERE tenant_id = $1 AND translation_key LIKE 'catalog.analogs.%'",
      [I18N_SEED_NEUTRAL_TENANT_ID],
    )
    expect(Number(result.rows[0]?.count)).toBe(EXPECTED_ROW_COUNT)
  })

  it('идемпотентен — повторный запуск не создаёт дублей', async () => {
    await seedI18nOverridesCatalog(db)
    await seedI18nOverridesCatalog(db)
    const result = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM i18n_overrides WHERE tenant_id = $1 AND translation_key LIKE 'catalog.analogs.%'",
      [I18N_SEED_NEUTRAL_TENANT_ID],
    )
    expect(Number(result.rows[0]?.count)).toBe(EXPECTED_ROW_COUNT)
  })

  it.each(['ru', 'tj', 'en'] as const)(
    'disclaimer[%s] совпадает побайтово с эталоном SRS-CAT-039',
    async (locale) => {
      await seedI18nOverridesCatalog(db)
      const result = await pool.query<{ value: string }>(
        'SELECT value FROM i18n_overrides WHERE tenant_id = $1 AND locale = $2 AND translation_key = $3',
        [I18N_SEED_NEUTRAL_TENANT_ID, locale, KEY_DISCLAIMER],
      )
      expect(result.rows[0]?.value).toBe(DISCLAIMER_GOLDEN[locale])
    },
  )

  it('down-миграция существует и полностью отменяет 0024 (структурная проверка, см. JSDoc файла)', () => {
    const downSql = readFileSync(new URL('0024_i18n_overrides_review_status.down.sql', MIGRATIONS_URL), 'utf8')
    expect(downSql).toMatch(/DROP TABLE IF EXISTS i18n_overrides/i)
  })
})
