/**
 * Интеграционный тест миграции `0039_returns_disputes_support.sql` (EP-11/14, DTJ-270,
 * тест-план тикета) — РЕАЛЬНЫЙ Postgres. Testcontainers НЕ используется (решение архитектора,
 * D-EP09-14/D-EP09-31, `reports/EP09-CTO-BRIEF.md` — повтор обоснования из
 * `payments-migration.integration.spec.ts`, ближайший прецедент для Группы E/F): тикет
 * упоминает Testcontainers по инерции текста, тест бьёт по настроенной БД.
 *
 * Проверяет:
 *  1. AC1 — структура/constraint'ы/индексы `order_returns`/`order_disputes`/
 *     `dispute_status_history` совпадают 1:1 с `11-database-schema.md` (Группа F, §4 Индексы).
 *  2. Частичные уникальные индексы `ux_order_returns_one_active`/`ux_order_disputes_one_active` —
 *     негативный сценарий: второй нетерминальный ряд для того же `order_id` отклоняется.
 *  3. `payout_schedule.held_by_dispute_id` — FK на `order_disputes(id)` реально применился
 *     (D-EP11-1 из брифа волны 5 больше не актуален: `orders`/`payout_schedule` существуют
 *     на этой волне — FK не отложен, применяется той же миграцией).
 *  4. Идемпотентность (правило 11 AGENTS.md) — применяется ДВАЖДЫ подряд без ошибки.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL =
  process.env.RETURNS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

/** Роль `test` не владеет таблицами (владелец — `dorutj_migrator`) — DDL идёт под мигратором, тот же приём, что `payments-migration.integration.spec.ts`. */
const MIGRATOR_DATABASE_URL = process.env.RETURNS_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    // Дев-дефолт, заведомо непроизводственный (правило 13 AGENTS.md), уже коммитится открыто.
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

const MIGRATION_SQL_PATH = fileURLToPath(new URL('../../../migrations/0039_returns_disputes_support.sql', import.meta.url))
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, 'utf8')

const RETURNS_TABLES = ['order_returns', 'order_disputes', 'dispute_status_history'] as const

interface ConstraintRow {
  readonly table_name: string
  readonly conname: string
}

/** Создаёт минимальный граф FK-родителей (tenant/user/order/support_ticket), нужный тестам ниже. */
async function seedOrderAndTicket(
  client: PoolClient,
): Promise<{ readonly orderId: string; readonly userId: string; readonly ticketId: string }> {
  const tenantId = randomUUID()
  await client.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
    tenantId,
    `dtj270-${tenantId.slice(0, 8)}`,
  ])
  const userId = randomUUID()
  await client.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [userId, tenantId])
  const orderId = randomUUID()
  // payment_method='alif_mobi' (не 'cash_courier') — тот же приём, что
  // `payments-migration.integration.spec.ts`: 'cash_courier' с дефолтным
  // status='pending_payment' нарушает chk_orders_cash_never_escrow (D-25), не связанный с этой
  // проверкой констрейнт.
  await client.query(
    `INSERT INTO orders
       (id, order_number, customer_id, payment_method, items_total_tjs, delivery_fee_tjs,
        total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
     VALUES ($1, $2, $3, 'alif_mobi', 10.00, 0.00, 10.00, 'x', $4, gen_random_uuid())`,
    [orderId, `DTJ270-${randomUUID().slice(0, 8)}`, userId, tenantId],
  )
  const ticketId = randomUUID()
  await client.query(
    `INSERT INTO support_tickets (id, order_id, tenant_id, channel, category, status)
     VALUES ($1, $2, $3, 'in_app', 'order_not_received', 'open')`,
    [ticketId, orderId, tenantId],
  )
  return { orderId, userId, ticketId }
}

describe.skipIf(!postgresAvailable)('0039_returns_disputes_support.sql — Группа F (DTJ-270)', () => {
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

  describe('AC1 — структура таблиц 1:1 с 11-database-schema.md', () => {
    it('все три таблицы существуют', async () => {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [RETURNS_TABLES],
      )
      expect(result.rows.map((r) => r.table_name).sort()).toEqual([...RETURNS_TABLES].sort())
    })

    it('order_returns.courier_return_fee_diram — BIGINT NOT NULL (правило 6 AGENTS.md)', async () => {
      const result = await pool.query<{ data_type: string; is_nullable: 'YES' | 'NO' }>(
        `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'order_returns' AND column_name = 'courier_return_fee_diram'`,
      )
      expect(result.rows[0]?.data_type).toBe('bigint')
      expect(result.rows[0]?.is_nullable).toBe('NO')
    })

    it('оба CHECK-констрейнта присутствуют', async () => {
      const result = await pool.query<ConstraintRow>(
        `SELECT rel.relname AS table_name, con.conname
           FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = ANY($1) AND con.contype = 'c'`,
        [RETURNS_TABLES],
      )
      const names = result.rows.map((r) => r.conname)
      expect(names).toEqual(
        expect.arrayContaining(['chk_order_returns_fee_nonneg', 'chk_order_disputes_terminal_requires_reason']),
      )
    })

    it('return_status/return_reason/return_disposition/dispute_status enum — значения 1:1 со спекой', async () => {
      const result = await pool.query<{ typname: string; enumlabel: string }>(
        `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = ANY($1) ORDER BY t.typname, e.enumsortorder`,
        [['return_status', 'return_reason', 'return_disposition', 'dispute_status']],
      )
      const byType = new Map<string, string[]>()
      for (const row of result.rows) {
        byType.set(row.typname, [...(byType.get(row.typname) ?? []), row.enumlabel])
      }
      expect(byType.get('return_status')).toEqual([
        'return_requested',
        'return_in_transit',
        'returned_to_pharmacy',
        'return_confirmed',
        'return_rejected',
      ])
      expect(byType.get('return_reason')).toEqual([
        'defect',
        'wrong_item',
        'damaged_packaging',
        'expired_or_near_expiry',
        'undelivered',
        'refused_at_door',
        'undeliverable',
        'customer_dispute_post_delivery',
      ])
      expect(byType.get('return_disposition')).toEqual(['restock', 'destroy', 'pending_inspection'])
      expect(byType.get('dispute_status')).toEqual([
        'open',
        'awaiting_customer',
        'resolved_reject',
        'resolved_refund_full',
        'resolved_refund_partial',
        'resolved_adjustment',
      ])
    })

    it('payout_schedule.held_by_dispute_id — FK на order_disputes(id) применился', async () => {
      const result = await pool.query<{ confrelid_table: string }>(
        `SELECT confrelid::regclass::text AS confrelid_table
           FROM pg_constraint WHERE conname = 'fk_payout_schedule_dispute'`,
      )
      expect(result.rows[0]?.confrelid_table).toBe('order_disputes')
    })

    it('CHECK chk_order_returns_fee_nonneg отклоняет courier_return_fee_diram < 0 (23514)', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { orderId, userId } = await seedOrderAndTicket(client)
        await expect(
          client.query(
            `INSERT INTO order_returns (order_id, reason, initiated_by, courier_return_fee_diram)
             VALUES ($1, 'defect', $2, -1)`,
            [orderId, userId],
          ),
        ).rejects.toMatchObject({ code: '23514' })
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    })

    it('CHECK chk_order_disputes_terminal_requires_reason отклоняет терминальный статус без resolution_reason (23514)', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { orderId, ticketId } = await seedOrderAndTicket(client)
        await expect(
          client.query(
            `INSERT INTO order_disputes (order_id, support_ticket_id, status, resolution_due_at)
             VALUES ($1, $2, 'resolved_reject', NOW() + INTERVAL '1 day')`,
            [orderId, ticketId],
          ),
        ).rejects.toMatchObject({ code: '23514' })
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    })
  })

  describe('AC — частичные уникальные индексы «не более одного нетерминального»', () => {
    it('ux_order_returns_one_active отклоняет второй нетерминальный возврат на тот же order_id (23505)', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { orderId, userId } = await seedOrderAndTicket(client)
        await client.query(`INSERT INTO order_returns (order_id, reason, initiated_by) VALUES ($1, 'defect', $2)`, [
          orderId,
          userId,
        ])
        await expect(
          client.query(`INSERT INTO order_returns (order_id, reason, initiated_by) VALUES ($1, 'wrong_item', $2)`, [
            orderId,
            userId,
          ]),
        ).rejects.toMatchObject({ code: '23505' })
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    })

    it('ux_order_disputes_one_active отклоняет второй нетерминальный спор на тот же order_id (23505, аналог TC-DB-007)', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const { orderId, ticketId } = await seedOrderAndTicket(client)
        await client.query(
          `INSERT INTO order_disputes (order_id, support_ticket_id, status, resolution_due_at)
           VALUES ($1, $2, 'open', NOW() + INTERVAL '1 day')`,
          [orderId, ticketId],
        )
        await expect(
          client.query(
            `INSERT INTO order_disputes (order_id, support_ticket_id, status, resolution_due_at)
             VALUES ($1, $2, 'awaiting_customer', NOW() + INTERVAL '1 day')`,
            [orderId, ticketId],
          ),
        ).rejects.toMatchObject({ code: '23505' })
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    })
  })

  describe.skipIf(!migratorAvailable)('Идемпотентность (правило 11 AGENTS.md)', () => {
    it('применяется ДВАЖДЫ подряд без ошибки, ровно один объект каждого типа остаётся', async () => {
      await migratorPool.query(MIGRATION_SQL)
      await expect(migratorPool.query(MIGRATION_SQL)).resolves.toBeDefined()

      const tableCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [RETURNS_TABLES],
      )
      expect(tableCount.rows[0]?.count).toBe(String(RETURNS_TABLES.length))

      const typeCount = await pool.query<{ typname: string; count: string }>(
        `SELECT typname, count(*)::text AS count FROM pg_type
          WHERE typname IN ('return_status','return_reason','return_disposition','dispute_status')
          GROUP BY typname`,
      )
      for (const row of typeCount.rows) {
        expect(row.count, `type ${row.typname} must exist exactly once`).toBe('1')
      }

      const fkCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_constraint WHERE conname = 'fk_payout_schedule_dispute'`,
      )
      expect(fkCount.rows[0]?.count).toBe('1')
    })
  })
})
