/**
 * Интеграционный тест миграции `0028_orders_payments_extensions.sql` (EP-09, DTJ-228, тест-план
 * тикета) — РЕАЛЬНЫЙ Postgres. Проверяет: колонка `orders.billing_strategy` присутствует (`NOT
 * NULL DEFAULT 'single_invoice'`), `CHECK`-констрейнт отклоняет невалидное значение, миграция
 * идемпотентна (правило 9 AGENTS.md — применяется дважды подряд без ошибки).
 *
 * Не пишет строк в `orders` вне собственной транзакции ROLLBACK (проверка CHECK требует
 * попытки INSERT, откатываемой немедленно) — безопасен для параллельного использования БД.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

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

const MIGRATION_SQL_PATH = fileURLToPath(
  new URL('../../../migrations/0028_orders_payments_extensions.sql', import.meta.url),
)

interface ColumnRow {
  readonly column_name: string
  readonly data_type: string
  readonly is_nullable: 'YES' | 'NO'
  readonly column_default: string | null
}

describe.skipIf(!postgresAvailable)('0028_orders_payments_extensions.sql — billing_strategy (DTJ-228)', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  it('orders.billing_strategy — VARCHAR(20) NOT NULL DEFAULT single_invoice', async () => {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'billing_strategy'`,
    )
    const column = result.rows[0]
    expect(column).toBeDefined()
    expect(column?.data_type).toBe('character varying')
    expect(column?.is_nullable).toBe('NO')
    expect(column?.column_default).toContain('single_invoice')
  })

  it('CHECK chk_orders_billing_strategy_values — присутствует', async () => {
    const result = await pool.query<{ constraint_name: string }>(
      `SELECT con.conname AS constraint_name
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'orders' AND con.contype = 'c'`,
    )
    expect(result.rows.map((r) => r.constraint_name)).toContain('chk_orders_billing_strategy_values')
  })

  it('CHECK отклоняет невалидное значение billing_strategy (23514)', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const tenantId = randomUUID()
      await client.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
        tenantId,
        `dtj228-${tenantId.slice(0, 8)}`,
      ])
      const customerId = randomUUID()
      await client.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
      await expect(
        client.query(
          `INSERT INTO orders
             (id, order_number, customer_id, payment_method, items_total_tjs, delivery_fee_tjs,
              total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id, billing_strategy)
           VALUES (gen_random_uuid(), $1, $2, 'cash_courier', 10.00, 0.00, 10.00, 'x', $3, gen_random_uuid(), 'not_a_real_strategy')`,
          [`DTJ228-${randomUUID().slice(0, 8)}`, customerId, tenantId],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
    }
  })

  it('идемпотентность (правило 9 AGENTS.md) — применяется ДВАЖДЫ подряд без ошибки', async () => {
    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8')
    await pool.query(sql)
    await expect(pool.query(sql)).resolves.toBeDefined()
  })
})
