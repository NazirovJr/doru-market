/**
 * Интеграционный тест миграции `0032_payment_operations_invoice_cache.sql` (EP-10, DTJ-241) —
 * РЕАЛЬНЫЙ Postgres (Testcontainers не используется, D-EP09-14/31 — тот же приём, что
 * `payments-migration.integration.spec.ts`, DTJ-236, ближайший прецедент в этом же каталоге).
 *
 * Проверяет: (1) обе колонки существуют, nullable, корректного типа; (2) идемпотентность
 * (правило 11 AGENTS.md) — применяется ДВАЖДЫ подряд без ошибки, ровно один столбец каждого
 * имени остаётся.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

/** См. JSDoc `payments-migration.integration.spec.ts` — DDL требует роль-владельца таблицы. */
const MIGRATOR_DATABASE_URL = process.env.PAYMENTS_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    // Дев-дефолт, заведомо непроизводственный (правило 13 AGENTS.md) — тот же приём, что
    // соседний `payments-migration.integration.spec.ts`.
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

const MIGRATION_SQL_PATH = fileURLToPath(
  new URL('../../../migrations/0032_payment_operations_invoice_cache.sql', import.meta.url),
)
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, 'utf8')

interface ColumnRow {
  readonly column_name: string
  readonly data_type: string
  readonly is_nullable: 'YES' | 'NO'
}

describe.skipIf(!postgresAvailable)('0032_payment_operations_invoice_cache.sql (DTJ-241)', () => {
  let pool: Pool
  let migratorPool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    migratorPool = new Pool({ connectionString: MIGRATOR_DATABASE_URL })
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
    await migratorPool.end().catch(() => undefined)
  })

  it('qr_payload — text, nullable', async () => {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'payment_operations' AND column_name = 'qr_payload'`,
    )
    expect(result.rows[0]?.data_type).toBe('text')
    expect(result.rows[0]?.is_nullable).toBe('YES')
  })

  it('expires_at — timestamp with time zone, nullable', async () => {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'payment_operations' AND column_name = 'expires_at'`,
    )
    expect(result.rows[0]?.data_type).toBe('timestamp with time zone')
    expect(result.rows[0]?.is_nullable).toBe('YES')
  })

  describe.skipIf(!migratorAvailable)('Идемпотентность (правило 11 AGENTS.md)', () => {
    it('применяется ДВАЖДЫ подряд без ошибки, ровно один столбец каждого имени остаётся', async () => {
      await migratorPool.query(MIGRATION_SQL)
      await expect(migratorPool.query(MIGRATION_SQL)).resolves.toBeDefined()

      const result = await pool.query<{ column_name: string; count: string }>(
        `SELECT column_name, count(*)::text AS count FROM information_schema.columns
          WHERE table_name = 'payment_operations' AND column_name IN ('qr_payload', 'expires_at')
          GROUP BY column_name`,
      )
      expect(result.rows).toHaveLength(2)
      for (const row of result.rows) {
        expect(row.count, `column ${row.column_name} must exist exactly once`).toBe('1')
      }
    })
  })
})
