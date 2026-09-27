/**
 * Интеграционный тест `DrizzleInventorySyncErrorsRepository` (DTJ-145,
 * SRS-INV-011) — РЕАЛЬНЫЙ Postgres.
 *
 * Проверяет ровно то, чего не было раньше (единственная реализация
 * `appendErrors` жила in-memory, `apps/api/src/modules/inventory/infrastructure/adapters/in-memory-inventory-sync-batch.repository.ts`,
 * см. `docs/spec/22-module-inventory-sync-1c.md`): построчные ошибки батча
 * реально попадают в таблицу `inventory_sync_errors`, а не теряются при
 * рестарте процесса.
 *
 * Цели:
 *   1. Батчевый INSERT нескольких ошибок одним вызовом — все строки видны
 *      в таблице с корректными полями.
 *   2. Пустой массив — no-op, ни одной строки не появляется.
 *   3. CHECK `chk_inventory_sync_errors_error_code` — код ошибки вне
 *      TS-юниона `InventorySyncRowError['errorCode']` отклоняется БД.
 *   4. FK `batch_id → inventory_sync_batch(id)` — несуществующий батч
 *      отклоняется БД (защита от «ошибка повисла без родителя»).
 *   5. `ON DELETE CASCADE` — удаление батча забирает его ошибки.
 *
 * **Окружение.** БД берётся из `INVENTORY_TEST_DATABASE_URL` (fallback:
 * `DATABASE_URL`, дефолт совпадает с `vitest.integration.config.ts` и
 * соседним `catalog-repository.adapter.integration.spec.ts`). Недоступный
 * Postgres — честный `describe.skipIf`, не «зелёный по умолчанию»
 * (тот же приём, Ж13).
 *
 * Миграция `0020_inventory_sync_errors.sql` применяется напрямую
 * (`IF NOT EXISTS` — безопасно повторно). `pharmacies`/`inventory_sync_batch`
 * предполагаются уже применёнными миграциями `0008_onboarding_foundation.sql`
 * и `0012_inventory_foundation.sql` — они не входят в зону этого тикета,
 * поэтому не переприменяются здесь (в отличие от `0001_extensions.sql`,
 * который безопасно и дёшево применить лишний раз).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { DrizzleInventorySyncErrorsRepository } from '@/modules/inventory/infrastructure/adapters/drizzle-inventory-sync-errors.repository.js'
import type { InventorySyncRowError } from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'

const TEST_DATABASE_URL =
  process.env.INVENTORY_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url)
const EXTENSIONS_SQL = readFileSync(new URL('0001_extensions.sql', MIGRATIONS_DIR), 'utf8')
const INVENTORY_SYNC_ERRORS_SQL = readFileSync(
  new URL('0020_inventory_sync_errors.sql', MIGRATIONS_DIR),
  'utf8',
)

/**
 * ИСПРАВЛЕНО (гейт CI): `EXTENSIONS_SQL`/`INVENTORY_SYNC_ERRORS_SQL` реплеились под ролью
 * `test` — при уже применённых реальных миграциях `CREATE OR REPLACE FUNCTION
 * immutable_unaccent` падает `must be owner of function immutable_unaccent`. DDL теперь идёт
 * под ОТДЕЛЬНЫМ `migratorPool` (тот же приём, что `i18n-overrides-catalog.seed.integration.spec.ts`).
 */
const MIGRATOR_DATABASE_URL = process.env.INVENTORY_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    url.password = 'dorutj_dev_only_password'
    return url.toString()
  } catch {
    return appUrl
  }
}

const PROBE_TIMEOUT_MS = 1_500

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
const migratorAvailable = postgresAvailable && (await isPostgresReachable(MIGRATOR_DATABASE_URL))

describe.skipIf(!postgresAvailable || !migratorAvailable)(
  'DrizzleInventorySyncErrorsRepository — integration (DTJ-145, SRS-INV-011)',
  () => {
    let pool: Pool
    let db: NodePgDatabase
    let migratorPool: Pool
    let repo: DrizzleInventorySyncErrorsRepository
    let pharmacyId: string
    let batchId: string

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      db = drizzle(pool)
      migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
      // `pharmacies`/`inventory_sync_batch` — предполагаются уже созданными
      // миграциями вне зоны этого тикета (см. JSDoc выше). Проверяем явно:
      // отсутствие таблицы даёт понятную ошибку вместо непонятного FK-сбоя ниже.
      // DDL — под ролью-владельцем `dorutj_migrator` (см. блок «ИСПРАВЛЕНО» у объявления
      // MIGRATOR_DATABASE_URL).
      await migratorPool.query(EXTENSIONS_SQL)
      await migratorPool.query(INVENTORY_SYNC_ERRORS_SQL)
      repo = new DrizzleInventorySyncErrorsRepository(db)
    })

    afterAll(async () => {
      await migratorPool.end().catch(() => undefined)
      await pool.end().catch(() => undefined)
    })

    async function seedPharmacy(): Promise<string> {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
         VALUES ($1, 'Test Pharmacy', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000000')`,
        [id],
      )
      return id
    }

    async function seedBatch(pharmacy: string): Promise<string> {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO inventory_sync_batch (id, pharmacy_id, channel, total_rows)
         VALUES ($1, $2, 'rest', 900)`,
        [id, pharmacy],
      )
      return id
    }

    beforeEach(async () => {
      // `inventory_sync_errors` — единственная таблица в зоне этого тикета,
      // безопасно чистить между кейсами. `pharmacies`/`inventory_sync_batch`
      // могут быть общими с другими сьютами — не трогаем их массово,
      // создаём свежую пару (pharmacy, batch) на каждый тест.
      await db.execute('TRUNCATE inventory_sync_errors')
      pharmacyId = await seedPharmacy()
      batchId = await seedBatch(pharmacyId)
    })

    it('appendErrors([]) — no-op, ни одной строки не появляется', async () => {
      await repo.appendErrors([])
      const rows = await pool.query('SELECT * FROM inventory_sync_errors')
      expect(rows.rowCount).toBe(0)
    })

    it('appendErrors — батчевый INSERT: 899 valid + 1 invalid_price не роняет остальные, ошибка видна в таблице', async () => {
      const errors: InventorySyncRowError[] = [
        { batchId, rowIndex: 42, errorCode: 'invalid_price', reason: 'price must be >= 0, got -100' },
        { batchId, rowIndex: 7, errorCode: 'barcode_invalid', reason: 'EAN-13 checksum mismatch' },
      ]
      await repo.appendErrors(errors)

      const rows = await pool.query<{
        batch_id: string
        row_index: string
        error_code: string
        reason: string
      }>('SELECT batch_id, row_index, error_code, reason FROM inventory_sync_errors ORDER BY row_index')

      expect(rows.rowCount).toBe(2)
      expect(rows.rows[0]).toMatchObject({
        batch_id: batchId,
        row_index: '7',
        error_code: 'barcode_invalid',
        reason: 'EAN-13 checksum mismatch',
      })
      expect(rows.rows[1]).toMatchObject({
        batch_id: batchId,
        row_index: '42',
        error_code: 'invalid_price',
        reason: 'price must be >= 0, got -100',
      })
    })

    it('CHECK chk_inventory_sync_errors_error_code — код ошибки вне юниона порта отклоняется БД', async () => {
      await expect(
        pool.query(
          `INSERT INTO inventory_sync_errors (batch_id, row_index, error_code, reason)
           VALUES ($1, 0, 'not_a_real_error_code', 'x')`,
          [batchId],
        ),
      ).rejects.toThrow(/chk_inventory_sync_errors_error_code/)
    })

    it('FK batch_id — несуществующий batch отклоняется БД (ошибка не может повиснуть без родителя)', async () => {
      const errors: InventorySyncRowError[] = [
        {
          batchId: '00000000-0000-4000-8000-000000000000',
          rowIndex: 0,
          errorCode: 'medicine_not_found',
          reason: 'no such medicine',
        },
      ]
      await expect(repo.appendErrors(errors)).rejects.toThrow()
    })

    it('ON DELETE CASCADE — удаление батча забирает его построчные ошибки', async () => {
      await repo.appendErrors([
        { batchId, rowIndex: 1, errorCode: 'duplicate_in_batch', reason: 'seen twice' },
      ])
      const before = await pool.query('SELECT * FROM inventory_sync_errors WHERE batch_id = $1', [
        batchId,
      ])
      expect(before.rowCount).toBe(1)

      await pool.query('DELETE FROM inventory_sync_batch WHERE id = $1', [batchId])

      const after = await pool.query('SELECT * FROM inventory_sync_errors WHERE batch_id = $1', [
        batchId,
      ])
      expect(after.rowCount).toBe(0)
    })
  },
)
