/**
 * Интеграционный тест миграции `0037_pharmacy_terminal_schema.sql` (EP-12, DTJ-300) — РЕАЛЬНЫЙ
 * Postgres, не мок/фейк. Структура — по образцу `orders-migration.integration.spec.ts`
 * (`information_schema`/`pg_catalog`). Плюс: негативные тесты констрейнтов из критериев приёмки
 * тикета — реальные INSERT в `order_partial_fulfillment_requests` (`ux_partial_fulfillment_one_active`,
 * `chk_partial_fulfillment_amounts`), поэтому (в отличие от read-only `orders-migration...spec.ts`)
 * этот сьют создаёт/удаляет свои строки (`users`/`orders`/`order_partial_fulfillment_requests`) —
 * убирает за собой в `afterAll` (урок §6.5 `reports/EP09-CTO-BRIEF.md`).
 */
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL =
  process.env.ORDERS_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
// `0021_seed_neutral_tenant.sql` — гарантированно существует на ЛЮБОЙ полностью
// смигрированной БД (системный инвариант, не бизнес-данные).
const NEUTRAL_TENANT_ID = '00000000-0000-4000-8000-000000000001'

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

describe.skipIf(!postgresAvailable)(
  '0037_pharmacy_terminal_schema.sql — структура и констрейнты (DTJ-300)',
  () => {
    let pool: Pool
    let testUserId: string
    let testOrderId: string

    beforeAll(async () => {
      pool = new Pool({ connectionString: TEST_DATABASE_URL })
      const userResult = await pool.query<{ id: string }>(
        `INSERT INTO users (tenant_id, role, full_name) VALUES ($1, 'pharmacist', 'DTJ-300 fixture')
       RETURNING id`,
        [NEUTRAL_TENANT_ID],
      )
      testUserId = userResult.rows[0]!.id

      // status='confirmed' (не дефолтный 'pending_payment'): chk_orders_cash_never_escrow
      // (0027_orders_cash_never_escrow.sql, D-25) запрещает cash_courier в pending_payment/paid_escrow.
      const orderResult = await pool.query<{ id: string }>(
        `INSERT INTO orders (
         order_number, customer_id, tenant_id, payment_method, status,
         items_total_tjs, delivery_fee_tjs, total_amount_tjs,
         delivery_address, checkout_attempt_id
       ) VALUES ($1, $2, $3, 'cash_courier', 'confirmed', 100.00, 0.00, 100.00, 'DTJ-300 fixture address', gen_random_uuid())
       RETURNING id`,
        [`DTJ300-${String(Date.now())}`, testUserId, NEUTRAL_TENANT_ID],
      )
      testOrderId = orderResult.rows[0]!.id
    })

    afterAll(async () => {
      await pool.query('DELETE FROM order_partial_fulfillment_requests WHERE order_id = $1', [testOrderId])
      await pool.query('DELETE FROM orders WHERE id = $1', [testOrderId])
      await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
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

    async function constraintNamesOf(
      table: string,
      contype: 'c' | 'f' | 'p' | 'u',
    ): Promise<readonly string[]> {
      const result = await pool.query<ConstraintNameRow>(
        `SELECT con.conname AS constraint_name
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = $1 AND con.contype = $2`,
        [table, contype],
      )
      return result.rows.map((row) => row.constraint_name)
    }

    it('order_item_fulfillment_status — 3 значения в порядке DDL', async () => {
      const result = await pool.query<{ enumlabel: string }>(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'order_item_fulfillment_status' ORDER BY e.enumsortorder`,
      )
      expect(result.rows.map((row) => row.enumlabel)).toEqual(['pending', 'scanned_ok', 'unavailable'])
    })

    it('partial_fulfillment_status — 4 значения в порядке DDL', async () => {
      const result = await pool.query<{ enumlabel: string }>(
        `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'partial_fulfillment_status' ORDER BY e.enumsortorder`,
      )
      expect(result.rows.map((row) => row.enumlabel)).toEqual([
        'awaiting_customer',
        'confirmed',
        'rejected',
        'auto_confirmed_timeout',
      ])
    })

    it('orders.assigned_pharmacist_id — nullable UUID, FK → users(id)', async () => {
      const columns = await columnsOf('orders')
      const column = columns.find((c) => c.column_name === 'assigned_pharmacist_id')
      expect(column?.data_type).toBe('uuid')
      expect(column?.is_nullable).toBe('YES')

      const fk = await pool.query<{ foreign_table: string }>(
        `SELECT confrelid::regclass::text AS foreign_table FROM pg_constraint
        WHERE conname = 'orders_assigned_pharmacist_id_fkey'`,
      )
      expect(fk.rows[0]?.foreign_table).toBe('users')
    })

    it('order_items — 6 новых колонок присутствуют, CHECK-констрейнты именованы', async () => {
      const columns = await columnsOf('order_items')
      const names = columns.map((c) => c.column_name)
      expect(names).toEqual(
        expect.arrayContaining([
          'fulfillment_status',
          'scanned_batch_id',
          'scanned_at',
          'scanned_by',
          'scan_method',
          'item_issue_reason',
        ]),
      )
      const byName = new Map(columns.map((c) => [c.column_name, c]))
      expect(byName.get('fulfillment_status')?.is_nullable).toBe('NO')

      const checks = await constraintNamesOf('order_items', 'c')
      expect(checks).toEqual(
        expect.arrayContaining(['chk_order_items_scan_method', 'chk_order_items_item_issue_reason']),
      )
    })

    it('order_items.scanned_batch_id — FK → pharmacy_inventory (foundIssues: не inventory_batches, см. шапку миграции)', async () => {
      const result = await pool.query<{ foreign_table: string }>(
        `SELECT confrelid::regclass::text AS foreign_table FROM pg_constraint
        WHERE conname = 'order_items_scanned_batch_id_fkey'`,
      )
      expect(result.rows[0]?.foreign_table).toBe('pharmacy_inventory')
    })

    it('order_partial_fulfillment_requests — колонки, CHECK, PK присутствуют', async () => {
      const columns = await columnsOf('order_partial_fulfillment_requests')
      expect(columns.map((c) => c.column_name).sort()).toEqual(
        [
          'id',
          'order_id',
          'proposed_by',
          'items_snapshot',
          'items_total_before_diram',
          'items_total_after_diram',
          'refund_amount_diram',
          'status',
          'idempotency_key',
          'requested_at',
          'expires_at',
          'responded_at',
        ].sort(),
      )
      const checks = await constraintNamesOf('order_partial_fulfillment_requests', 'c')
      expect(checks).toContain('chk_partial_fulfillment_amounts')
      const primaryKeys = await constraintNamesOf('order_partial_fulfillment_requests', 'p')
      expect(primaryKeys).toHaveLength(1)
    })

    it('COMMENT ON TABLE order_partial_fulfillment_requests — записан', async () => {
      const result = await pool.query<{ comment: string | null }>(
        `SELECT obj_description('order_partial_fulfillment_requests'::regclass, 'pg_class') AS comment`,
      )
      expect(result.rows[0]?.comment).toContain('Запрос подтверждения изменённого состава заказа')
    })

    it('tenant_settings — 3 новые колонки + chk_tenant_settings_pht_ranges присутствуют', async () => {
      const columns = await columnsOf('tenant_settings')
      const names = columns.map((c) => c.column_name)
      expect(names).toEqual(
        expect.arrayContaining([
          'partial_fulfillment_confirmation_timeout_minutes',
          'handover_otp_max_regenerations_per_order',
          'handover_otp_regenerate_min_interval_seconds',
        ]),
      )
      const checks = await constraintNamesOf('tenant_settings', 'c')
      expect(checks).toContain('chk_tenant_settings_pht_ranges')
    })

    it('tenant_settings — дефолты новых колонок соответствуют спецификации (10 / 20 / 60)', async () => {
      const result = await pool.query<{
        partial_fulfillment_confirmation_timeout_minutes: number
        handover_otp_max_regenerations_per_order: number
        handover_otp_regenerate_min_interval_seconds: number
      }>(
        `SELECT partial_fulfillment_confirmation_timeout_minutes, handover_otp_max_regenerations_per_order,
              handover_otp_regenerate_min_interval_seconds
         FROM tenant_settings WHERE tenant_id = $1`,
        [NEUTRAL_TENANT_ID],
      )
      expect(result.rows[0]?.partial_fulfillment_confirmation_timeout_minutes).toBe(10)
      expect(result.rows[0]?.handover_otp_max_regenerations_per_order).toBe(20)
      expect(result.rows[0]?.handover_otp_regenerate_min_interval_seconds).toBe(60)
    })

    it('AC (критерий приёмки #2): вторая awaiting_customer-запись на тот же order_id отклоняется (ux_partial_fulfillment_one_active)', async () => {
      const insertOne = () =>
        pool.query(
          `INSERT INTO order_partial_fulfillment_requests (
           order_id, proposed_by, items_snapshot,
           items_total_before_diram, items_total_after_diram, refund_amount_diram,
           idempotency_key, expires_at
         ) VALUES ($1, $2, '[]'::jsonb, 10000, 7000, 3000, $3, NOW() + interval '10 minutes')`,
          [testOrderId, testUserId, `idem-${String(Date.now())}-${String(Math.random())}`],
        )

      await insertOne()
      await expect(insertOne()).rejects.toThrow(/duplicate key|ux_partial_fulfillment_one_active/i)
    })

    it('AC (критерий приёмки #3): items_total_after_diram=7000/refund_amount_diram=2000 (несовпадающая арифметика) отклоняется (chk_partial_fulfillment_amounts)', async () => {
      await expect(
        pool.query(
          `INSERT INTO order_partial_fulfillment_requests (
           order_id, proposed_by, items_snapshot,
           items_total_before_diram, items_total_after_diram, refund_amount_diram,
           status, idempotency_key, expires_at
         ) VALUES ($1, $2, '[]'::jsonb, 10000, 7000, 2000, 'rejected', $3, NOW() + interval '10 minutes')`,
          [testOrderId, testUserId, `idem-${String(Date.now())}-${String(Math.random())}`],
        ),
      ).rejects.toThrow(/chk_partial_fulfillment_amounts|violates check constraint/i)
    })

    it('AC (критерий приёмки #3, позитив): items_total_after_diram=7000/refund_amount_diram=3000 (корректная арифметика) — вставка проходит', async () => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO order_partial_fulfillment_requests (
         order_id, proposed_by, items_snapshot,
         items_total_before_diram, items_total_after_diram, refund_amount_diram,
         status, idempotency_key, expires_at
       ) VALUES ($1, $2, '[]'::jsonb, 10000, 7000, 3000, 'rejected', $3, NOW() + interval '10 minutes')
       RETURNING id`,
        [testOrderId, testUserId, `idem-${String(Date.now())}-${String(Math.random())}`],
      )
      expect(result.rows[0]?.id).toBeTruthy()
    })
  },
)
