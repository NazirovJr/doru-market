/**
 * Интеграционный тест миграции `0038_support_ticket_sla_fields.sql` (EP-14, DTJ-278,
 * тест-план тикета) — РЕАЛЬНЫЙ Postgres, Testcontainers НЕ используется (тот же прецедент, что
 * `returns-disputes-support-migration.integration.spec.ts`/D-EP09-14/D-EP09-31).
 *
 * Проверяет: три новые колонки `support_tickets` (SLA/приоритет), новая колонка
 * `tenant_settings.support_first_response_sla_minutes` (default 60), таблица
 * `support_ticket_messages` (структура + FK на `support_tickets`), идемпотентность двойного
 * применения (правило 11 AGENTS.md). Применяется ПОСЛЕ `0037` (DTJ-270), зависимость проверена
 * реальным `ALTER TABLE support_tickets` — миграция упадёт, если 0037/0034 не применены раньше.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL =
  process.env.SUPPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const MIGRATOR_DATABASE_URL = process.env.SUPPORT_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

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

// DTJ-282 fix: файл переномерован 0038→0040 при мёрже последующих эпиков (EP-10..EP-13 волны
// добавили миграции перед этой веткой) — путь был осиротевшим, тест падал на readFileSync ДО
// одного реального assert (см. `ls apps/api/migrations/` — актуальный файл `0040_...`).
const MIGRATION_SQL_PATH = fileURLToPath(new URL('../../../migrations/0040_support_ticket_sla_fields.sql', import.meta.url))
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, 'utf8')

interface ColumnRow {
  readonly column_name: string
  readonly data_type: string
  readonly is_nullable: 'YES' | 'NO'
  readonly column_default: string | null
}

describe.skipIf(!postgresAvailable)('0038_support_ticket_sla_fields.sql — SLA/приоритет (DTJ-278)', () => {
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

  it('support_tickets.priority — SMALLINT NOT NULL DEFAULT 0', async () => {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'support_tickets' AND column_name = 'priority'`,
    )
    expect(result.rows[0]?.data_type).toBe('smallint')
    expect(result.rows[0]?.is_nullable).toBe('NO')
    expect(result.rows[0]?.column_default).toContain('0')
  })

  it('support_tickets.first_response_due_at/first_responded_at — TIMESTAMPTZ, nullable', async () => {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'support_tickets' AND column_name IN ('first_response_due_at', 'first_responded_at')
        ORDER BY column_name`,
    )
    expect(result.rows).toHaveLength(2)
    for (const row of result.rows) {
      expect(row.data_type).toBe('timestamp with time zone')
      expect(row.is_nullable).toBe('YES')
    }
  })

  it('tenant_settings.support_first_response_sla_minutes — INT NOT NULL DEFAULT 60 (SRS-ADM-075)', async () => {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_name = 'tenant_settings' AND column_name = 'support_first_response_sla_minutes'`,
    )
    expect(result.rows[0]?.data_type).toBe('integer')
    expect(result.rows[0]?.is_nullable).toBe('NO')
    expect(result.rows[0]?.column_default).toContain('60')
  })

  it('support_ticket_messages — существует, FK на support_tickets(id) ON DELETE CASCADE', async () => {
    const tableResult = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_ticket_messages'`,
    )
    expect(tableResult.rows).toHaveLength(1)

    const fkResult = await pool.query<{ confdeltype: string; ref_table: string }>(
      `SELECT confdeltype, confrelid::regclass::text AS ref_table
         FROM pg_constraint
        WHERE conrelid = 'support_ticket_messages'::regclass AND contype = 'f' AND conname = 'support_ticket_messages_ticket_id_fkey'`,
    )
    expect(fkResult.rows[0]?.ref_table).toBe('support_tickets')
    expect(fkResult.rows[0]?.confdeltype).toBe('c') // 'c' = CASCADE
  })

  it('support_ticket_messages.author_role — NOT NULL, INSERT/чтение проходит сквозной проверкой', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const tenantId = randomUUID()
      await client.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj278-${tenantId.slice(0, 8)}`])
      const ticketId = randomUUID()
      await client.query(
        `INSERT INTO support_tickets (id, tenant_id, channel, category, status) VALUES ($1, $2, 'in_app', 'other', 'open')`,
        [ticketId, tenantId],
      )
      const messageId = randomUUID()
      await client.query(
        `INSERT INTO support_ticket_messages (id, ticket_id, author_role, body) VALUES ($1, $2, 'support_agent', 'test message')`,
        [messageId, ticketId],
      )
      const readBack = await client.query<{ body: string }>(`SELECT body FROM support_ticket_messages WHERE id = $1`, [messageId])
      expect(readBack.rows[0]?.body).toBe('test message')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
    }
  })

  describe.skipIf(!migratorAvailable)('Идемпотентность (правило 11 AGENTS.md)', () => {
    it('применяется ДВАЖДЫ подряд без ошибки, ровно одна колонка/таблица каждого типа остаётся', async () => {
      await migratorPool.query(MIGRATION_SQL)
      await expect(migratorPool.query(MIGRATION_SQL)).resolves.toBeDefined()

      const columnCount = await pool.query<{ column_name: string; count: string }>(
        `SELECT column_name, count(*)::text AS count FROM information_schema.columns
          WHERE table_name = 'support_tickets' AND column_name IN ('priority', 'first_response_due_at', 'first_responded_at')
          GROUP BY column_name`,
      )
      for (const row of columnCount.rows) {
        expect(row.count, `column ${row.column_name} must exist exactly once`).toBe('1')
      }

      const tableCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'support_ticket_messages'`,
      )
      expect(tableCount.rows[0]?.count).toBe('1')
    })
  })
})
