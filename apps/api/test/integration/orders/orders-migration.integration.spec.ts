/**
 * Интеграционный тест миграции `0023_orders_cart.sql` (EP-09, DTJ-220) — РЕАЛЬНЫЙ Postgres,
 * не мок/фейк. Проверяет структуру `orders`/`order_items`/`cart`/`cart_items`/`favorites` и
 * enum `order_status` через `information_schema`/`pg_catalog` — критерий приёмки №1 тикета
 * («структура таблиц и все CONSTRAINT/COMMENT совпадают 1:1 с 11-database-schema.md»).
 *
 * Не пишет и не удаляет строк ни в одной таблице (`beforeAll`/`afterAll` не нужны для очистки)
 * — читает только каталог метаданных, поэтому безопасен для параллельного использования
 * тестовой БД другими сьютами (урок §6.5 `reports/EP09-CTO-BRIEF.md`: тест убирает за собой,
 * здесь — тривиально, потому что ничего не создаёт).
 */
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

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

interface ColumnRow {
  readonly column_name: string
  readonly data_type: string
  readonly is_nullable: 'YES' | 'NO'
}

interface ConstraintNameRow {
  readonly constraint_name: string
}

describe.skipIf(!postgresAvailable)('0023_orders_cart.sql — структура (DTJ-220)', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  async function columnsOf(table: string): Promise<readonly ColumnRow[]> {
    const result = await pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    )
    return result.rows
  }

  async function constraintNamesOf(table: string, contype: 'c' | 'f' | 'p' | 'u'): Promise<readonly string[]> {
    const result = await pool.query<ConstraintNameRow>(
      `SELECT con.conname AS constraint_name
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = $1 AND con.contype = $2`,
      [table, contype],
    )
    return result.rows.map((row) => row.constraint_name)
  }

  it('order_status — все 9 значений канонического DDL, включая confirmed и return_in_progress (D-25)', async () => {
    const result = await pool.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'order_status'
        ORDER BY e.enumsortorder`,
    )
    expect(result.rows.map((row) => row.enumlabel)).toEqual([
      'pending_payment',
      'confirmed',
      'paid_escrow',
      'processing',
      'picked_up',
      'delivered',
      'cancelled',
      'refunded',
      'return_in_progress',
    ])
  })

  it('orders — ключевые колонки и CHECK-констрейнты присутствуют', async () => {
    const columns = await columnsOf('orders')
    const byName = new Map(columns.map((c) => [c.column_name, c]))
    expect(byName.get('status')?.data_type).toBe('USER-DEFINED')
    expect(byName.get('items_total_tjs')?.data_type).toBe('numeric')
    expect(byName.get('checkout_attempt_id')?.is_nullable).toBe('NO')
    expect(byName.get('tenant_id')?.is_nullable).toBe('NO')
    // D-EP09-3: courier_id/prescription_id — существуют, но без REFERENCES.
    // D-EP09-7 (поправка CTO): handover_otp_id — существует И с REFERENCES на otp_codes.
    expect(byName.has('courier_id')).toBe(true)
    expect(byName.has('prescription_id')).toBe(true)
    expect(byName.has('handover_otp_id')).toBe(true)

    const checks = await constraintNamesOf('orders', 'c')
    expect(checks).toEqual(
      expect.arrayContaining(['chk_orders_total_matches_sum', 'chk_orders_amounts_nonnegative']),
    )

    const foreignKeys = await constraintNamesOf('orders', 'f')
    // Изначально ровно 5 FK — courier_id/prescription_id сознательно БЕЗ FK на этом шаге
    // (D-EP09-3, раздел «ОТЛОЖЕНО» миграции 0023); handover_otp_id получает FK сразу (D-EP09-7).
    // orders_courier_id_fkey ДОБАВЛЕН миграцией 0037_delivery_module_schema.sql (EP-13, DTJ-313)
    // — TODO(DTJ-313) из 0023 закрыт: couriers физически создана этим тикетом (Группа H), FK
    // достижима. prescription_id остаётся БЕЗ FK — prescriptions ещё не существует (TODO(R2-4)).
    expect([...foreignKeys].sort()).toEqual(
      [
        'orders_customer_id_fkey',
        'orders_pharmacy_id_fkey',
        'orders_tenant_id_fkey',
        'orders_cancelled_by_fkey',
        'orders_handover_otp_id_fkey',
        'orders_courier_id_fkey',
      ].sort(),
    )

    const handoverOtpFk = await pool.query<{ foreign_table: string }>(
      `SELECT confrelid::regclass::text AS foreign_table
         FROM pg_constraint
        WHERE conname = 'orders_handover_otp_id_fkey'`,
    )
    expect(handoverOtpFk.rows[0]?.foreign_table).toBe('otp_codes')
  })

  it('order_items — CHECK-констрейнты и FK на pharmacy_inventory (foundIssues: не inventory_batches)', async () => {
    const checks = await constraintNamesOf('order_items', 'c')
    expect(checks).toEqual(
      expect.arrayContaining([
        'chk_order_items_price_positive',
        'chk_order_items_quantity_positive',
        'chk_order_items_total_matches',
      ]),
    )

    const result = await pool.query<{ foreign_table: string }>(
      `SELECT confrelid::regclass::text AS foreign_table
         FROM pg_constraint
        WHERE conname = 'order_items_inventory_batch_id_fkey'`,
    )
    expect(result.rows[0]?.foreign_table).toBe('pharmacy_inventory')
  })

  it('cart — chk_cart_owner присутствует', async () => {
    const checks = await constraintNamesOf('cart', 'c')
    expect(checks).toContain('chk_cart_owner')
  })

  it('cart_items — unique_cart_medicine_pharmacy и chk_cart_items_quantity_positive присутствуют', async () => {
    const checks = await constraintNamesOf('cart_items', 'c')
    expect(checks).toContain('chk_cart_items_quantity_positive')
    const uniques = await constraintNamesOf('cart_items', 'u')
    expect(uniques).toContain('unique_cart_medicine_pharmacy')
  })

  it('favorites — композитный PK (user_id, medicine_id)', async () => {
    const primaryKeys = await constraintNamesOf('favorites', 'p')
    expect(primaryKeys).toHaveLength(1)
    const columns = await columnsOf('favorites')
    expect(columns.map((c) => c.column_name).sort()).toEqual(['created_at', 'medicine_id', 'user_id'])
  })

  it('COMMENT ON TABLE orders — записан (критерий приёмки: COMMENT совпадают с DDL)', async () => {
    const result = await pool.query<{ comment: string | null }>(
      `SELECT obj_description('orders'::regclass, 'pg_class') AS comment`,
    )
    expect(result.rows[0]?.comment).toContain('Order aggregate root')
  })
})
