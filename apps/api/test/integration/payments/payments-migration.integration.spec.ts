/**
 * Интеграционный тест миграции `0029_payments.sql` (EP-10, DTJ-236, тест-план тикета) —
 * РЕАЛЬНЫЙ Postgres. Testcontainers НЕ используется (повтор D-EP09-14/D-EP09-31,
 * `reports/EP09-CTO-BRIEF.md`) — тикет DTJ-236 упоминает Testcontainers по инерции текста,
 * решение архитектора уже отменяет их для всего проекта; тест бьёт по настроенной БД, как
 * `orders-payments-extensions-migration.integration.spec.ts` (DTJ-228, ближайший прецедент).
 *
 * Проверяет:
 *  1. AC1 — структура/констрейнты/комментарии `escrow_ledger`/`payout_schedule`/
 *     `platform_fee`/`payment_operations` совпадают 1:1 с `11-database-schema.md`.
 *  2. AC2 (негативный) — без `orders` (миграция `0023_orders_cart.sql`) `0029_payments.sql`
 *     падает на FOREIGN KEY. Изолируется отдельной ПУСТОЙ Postgres-схемой с `search_path`,
 *     который НЕ включает `public` (где `orders` уже существует в этой же тестовой БД) —
 *     не пересоздаёт БД, безопасно для параллельного использования `dorutj_test2`.
 *  3. Идемпотентность (правило 11 AGENTS.md) — применяется ДВАЖДЫ подряд без ошибки,
 *     ровно один экземпляр каждого объекта (перепроверка счётчиков после повторного прогона).
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

/**
 * Роль `test` (обычное прикладное соединение, `TEST_DATABASE_URL` выше) НЕ владеет таблицами,
 * применёнными миграцией (роль-владелец — `dorutj_migrator`, задание сессии) — повторный
 * прогон DDL самой миграции (идемпотентность) и `CREATE SCHEMA`/DDL для AC2 обязаны идти под
 * ролью-мигратором, иначе Postgres отвечает `must be owner of table` (не связано с самой
 * миграцией — это защита ролевой модели БД, обнаружено при первом прогоне этого файла).
 * DML (`SELECT`/`INSERT`) остаётся на обычной `TEST_DATABASE_URL` — прикладная роль имеет на
 * это права, как показывают остальные тесты этого файла.
 */
const MIGRATOR_DATABASE_URL = process.env.PAYMENTS_MIGRATOR_DATABASE_URL ?? buildMigratorUrl(TEST_DATABASE_URL)

function buildMigratorUrl(appUrl: string): string {
  try {
    const url = new URL(appUrl)
    url.username = 'dorutj_migrator'
    // Дев-дефолт, уже коммитится в открытом виде (`infra/docker/docker-compose.yml`
    // `POSTGRES_PASSWORD:-dorutj_dev_only_password`) — заведомо непроизводственный (правило 13
    // AGENTS.md), не секрет.
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

const MIGRATION_SQL_PATH = fileURLToPath(new URL('../../../migrations/0029_payments.sql', import.meta.url))
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, 'utf8')

const PAYMENTS_TABLES = ['escrow_ledger', 'payout_schedule', 'platform_fee', 'payment_operations'] as const

interface ColumnRow {
  readonly column_name: string
  readonly data_type: string
  readonly is_nullable: 'YES' | 'NO'
}

interface ConstraintRow {
  readonly table_name: string
  readonly conname: string
}

describe.skipIf(!postgresAvailable)('0029_payments.sql — Группа E (DTJ-236)', () => {
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
    it('все четыре таблицы существуют', async () => {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [PAYMENTS_TABLES],
      )
      expect(result.rows.map((r) => r.table_name).sort()).toEqual([...PAYMENTS_TABLES].sort())
    })

    it('escrow_ledger.amount_diram — BIGINT NOT NULL (правило 6 AGENTS.md: целые дирамы)', async () => {
      const result = await pool.query<ColumnRow>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'escrow_ledger' AND column_name = 'amount_diram'`,
      )
      expect(result.rows[0]?.data_type).toBe('bigint')
      expect(result.rows[0]?.is_nullable).toBe('NO')
    })

    it('payout_schedule.order_id — UNIQUE (1:1 с заказом, REQ-PAY-6)', async () => {
      const result = await pool.query<ConstraintRow>(
        `SELECT rel.relname AS table_name, con.conname
           FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = 'payout_schedule' AND con.contype = 'u'`,
      )
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('payment_operations.idempotency_key — UNIQUE (REQ-PAY-8)', async () => {
      const result = await pool.query<ConstraintRow>(
        `SELECT rel.relname AS table_name, con.conname
           FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = 'payment_operations' AND con.contype = 'u'`,
      )
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('все шесть CHECK-констрейнтов присутствуют', async () => {
      const result = await pool.query<ConstraintRow>(
        `SELECT rel.relname AS table_name, con.conname
           FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = ANY($1) AND con.contype = 'c'`,
        [PAYMENTS_TABLES],
      )
      const names = result.rows.map((r) => r.conname)
      expect(names).toEqual(
        expect.arrayContaining([
          'chk_escrow_ledger_amount_positive',
          'chk_escrow_ledger_adjustment_requires_reason',
          'chk_payout_schedule_net_matches',
          'chk_payout_schedule_amounts_nonneg',
          'chk_platform_fee_bps_range',
          'chk_platform_fee_date_range',
        ]),
      )
    })

    it('escrow_entry_type/payout_status/payment_operation_type enum — значения 1:1 со спекой', async () => {
      const result = await pool.query<{ typname: string; enumlabel: string }>(
        `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = 'escrow_entry_type' ORDER BY e.enumsortorder`,
      )
      expect(result.rows.map((r) => r.enumlabel)).toEqual([
        'hold_created',
        'platform_fee_captured',
        'captured_to_pharmacy',
        'refunded_to_customer',
        'partially_refunded',
        'adjustment',
      ])
    })

    it('CHECK chk_escrow_ledger_amount_positive отклоняет amount_diram <= 0 (23514)', async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tenantId = randomUUID()
        await client.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [
          tenantId,
          `dtj236-${tenantId.slice(0, 8)}`,
        ])
        const customerId = randomUUID()
        await client.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
        const orderId = randomUUID()
        // `payment_method='alif_mobi'` (не `cash_courier`) — `escrow_ledger` семантически
        // существует только для non-cash заказов (D-25, §4.6). Со статусом-дефолтом
        // `pending_payment` заказ не нарушает `chk_orders_cash_never_escrow` (тот констрейнт
        // касается только `cash_courier`) — эта проверка целит ИСКЛЮЧИТЕЛЬНО в
        // `chk_escrow_ledger_amount_positive`, D-25 здесь не под тестом.
        await client.query(
          `INSERT INTO orders
             (id, order_number, customer_id, payment_method, items_total_tjs, delivery_fee_tjs,
              total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
           VALUES ($1, $2, $3, 'alif_mobi', 10.00, 0.00, 10.00, 'x', $4, gen_random_uuid())`,
          [orderId, `DTJ236-${randomUUID().slice(0, 8)}`, customerId, tenantId],
        )
        await expect(
          client.query(
            `INSERT INTO escrow_ledger (order_id, entry_type, direction, amount_diram)
             VALUES ($1, 'hold_created', 'debit', 0)`,
            [orderId],
          ),
        ).rejects.toMatchObject({ code: '23514' })
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    })
  })

  describe.skipIf(!migratorAvailable)('AC2 — без orders (0023_orders_cart.sql) миграция падает на FOREIGN KEY', () => {
    it('CREATE TABLE escrow_ledger падает с 42P01 (relation "orders" does not exist)', async () => {
      const schemaName = `payments_neg_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      const client = await migratorPool.connect()
      try {
        await client.query(`CREATE SCHEMA "${schemaName}"`)
        // `search_path` БЕЗ `public` — `orders` физически существует в `public` этой же тестовой
        // БД (нужен другим сьютам), но негативный сценарий обязан не видеть его вовсе, иначе
        // проверка ничего не доказывает. `gen_random_uuid()`/enum-типы `pg_catalog` остаются
        // видимы — они не схемо-зависимы (PostgreSQL 16, встроены в ядро с версии 13).
        await client.query(`SET search_path TO "${schemaName}"`)
        await expect(client.query(MIGRATION_SQL)).rejects.toMatchObject({ code: '42P01' })
      } finally {
        await client.query('RESET search_path').catch(() => undefined)
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined)
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
        [PAYMENTS_TABLES],
      )
      expect(tableCount.rows[0]?.count).toBe(String(PAYMENTS_TABLES.length))

      const constraintCount = await pool.query<{ conname: string; count: string }>(
        `SELECT con.conname, count(*)::text AS count
           FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = ANY($1) AND con.contype = 'c'
          GROUP BY con.conname`,
        [PAYMENTS_TABLES],
      )
      for (const row of constraintCount.rows) {
        expect(row.count, `constraint ${row.conname} must exist exactly once`).toBe('1')
      }

      const typeCount = await pool.query<{ typname: string; count: string }>(
        `SELECT typname, count(*)::text AS count FROM pg_type
          WHERE typname IN ('escrow_entry_type','escrow_entry_direction','payout_status',
                             'payment_operation_type','payment_operation_status')
          GROUP BY typname`,
      )
      for (const row of typeCount.rows) {
        expect(row.count, `type ${row.typname} must exist exactly once`).toBe('1')
      }
    })
  })
})
