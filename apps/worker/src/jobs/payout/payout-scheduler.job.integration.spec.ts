/**
 * Интеграционный тест `PayoutSchedulerJob` (DTJ-249, AC1/AC4) — РЕАЛЬНЫЙ Postgres, батчевый
 * `UPDATE` через `PgPayoutSchedulerAdapter`. Тот же приём, что `unpaid-order-timeout.job.
 * integration.spec.ts` (DTJ-253): `describe.skipIf(!postgresAvailable)`, прямой `pg.Pool`,
 * реальные `orders`/`payout_schedule`-строки. AC2/AC3 (`HoldPayoutUseCase`) — отдельный файл
 * `apps/api/test/integration/payments/hold-payout.integration.spec.ts` (apps/api владеет
 * `PayoutScheduleRepository`/Drizzle, apps/worker сюда не имеет доступа, см. JSDoc
 * `payout-scheduler.job.ts`).
 *
 * ИСПРАВЛЕНО (найдено при реализации DTJ-251, не собственный дефект этого тикета в момент
 * первого написания — тот же баг класс скопирован из прецедента `unpaid-order-timeout.job.
 * integration.spec.ts`): `order_number` строился как литеральный `DTJ-260904-NNNNN` с
 * ЛОКАЛЬНЫМ счётчиком файла — `apps/worker`'s `vitest run` (в отличие от `apps/api`'s
 * `vitest.integration.config.ts`) НЕ сериализует файлы (`fileParallelism` не отключён), а
 * `orders.order_number` глобально `UNIQUE` — несколько `*.integration.spec.ts`-файлов,
 * стартующих счётчик с 1 с ОДНИМ и тем же литеральным префиксом, конкурентно вставляют
 * `DTJ-260904-00001` и получают `duplicate key value violates unique constraint
 * "orders_order_number_key"` (найдено живым прогоном `pnpm verify` при добавлении ТРЕТЬЕГО
 * такого файла, `cash-commission-aggregation.job.integration.spec.ts`, DTJ-251). Решение —
 * `uniqueOrderNumber()` на `randomUUID()`, коллизия между процессами astronomически
 * маловероятна вне зависимости от количества параллельных файлов.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PayoutSchedulerJob } from './payout-scheduler.job.js'
import { PgPayoutSchedulerAdapter } from './pg-payout-scheduler.adapter.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const PROBE_TIMEOUT_MS = 1_500
const MS_PER_DAY = 24 * 60 * 60 * 1000
const ORDER_NUMBER_HEX_LENGTH = 16

/** `varchar(20)`, `UNIQUE` (без формата на уровне БД) — см. JSDoc файла про гонку между конкурентными `*.integration.spec.ts`. */
function uniqueOrderNumber(): string {
  return `DTJ-${randomUUID().replace(/-/g, '').slice(0, ORDER_NUMBER_HEX_LENGTH).toUpperCase()}`
}

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

describe.skipIf(!postgresAvailable)('PayoutSchedulerJob — integration (DTJ-249)', () => {
  let pool: Pool
  const tenantId = randomUUID()
  let customerId: string
  let pharmacyId: string
  const createdOrderIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj249-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
    pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-249 Test Pharmacy', 'x', 38.5, 68.7, '+992900000249')`,
      [pharmacyId],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM payout_schedule WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
  })

  async function seedOrderWithPayout(input: { deliveredDaysAgo: number; holdPeriodDays: number; payoutStatus: string }): Promise<string> {
    const orderId = randomUUID()
    const deliveredAt = new Date(Date.now() - input.deliveredDaysAgo * MS_PER_DAY)
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method, delivered_at,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'delivered', 'alif_mobi', $5, 200.00, 0.00, 200.00, 'Dushanbe, Rudaki 1', $6, $7)`,
      [orderId, uniqueOrderNumber(), customerId, pharmacyId, deliveredAt, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO payout_schedule
         (id, order_id, pharmacy_id, status, gross_amount_diram, commission_diram, net_amount_diram, hold_period_days)
       VALUES (gen_random_uuid(), $1, $2, $3, 20000, 1600, 18400, $4)`,
      [orderId, pharmacyId, input.payoutStatus, input.holdPeriodDays],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  async function payoutStatusOf(orderId: string): Promise<{ status: string; due_at: Date | null }> {
    const result = await pool.query<{ status: string; due_at: Date | null }>(
      'SELECT status, due_at FROM payout_schedule WHERE order_id = $1',
      [orderId],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error(`payoutStatusOf: no payout_schedule row for order ${orderId}`)
    return row
  }

  it('AC1: pending, hold_period_days=1, delivered 2 дня назад → due, due_at заполнен', async () => {
    const orderId = await seedOrderWithPayout({ deliveredDaysAgo: 2, holdPeriodDays: 1, payoutStatus: 'pending' })
    const job = new PayoutSchedulerJob(new PgPayoutSchedulerAdapter(pool))

    const result = await job.runOnce()

    expect(result.movedToDue).toBeGreaterThanOrEqual(1)
    const row = await payoutStatusOf(orderId)
    expect(row.status).toBe('due')
    expect(row.due_at).not.toBeNull()
  })

  it('pending, hold_period_days=5, delivered сегодня — hold ещё НЕ истёк, остаётся pending', async () => {
    const orderId = await seedOrderWithPayout({ deliveredDaysAgo: 0, holdPeriodDays: 5, payoutStatus: 'pending' })
    const job = new PayoutSchedulerJob(new PgPayoutSchedulerAdapter(pool))

    await job.runOnce()

    const row = await payoutStatusOf(orderId)
    expect(row.status).toBe('pending')
  })

  it('AC4: disputed/due/pending одновременно — только просроченный pending переходит в due, disputed НЕ затронут', async () => {
    const pendingOrderId = await seedOrderWithPayout({ deliveredDaysAgo: 3, holdPeriodDays: 1, payoutStatus: 'pending' })
    const disputedOrderId = await seedOrderWithPayout({ deliveredDaysAgo: 10, holdPeriodDays: 1, payoutStatus: 'disputed' })
    const alreadyDueOrderId = await seedOrderWithPayout({ deliveredDaysAgo: 10, holdPeriodDays: 1, payoutStatus: 'due' })
    const job = new PayoutSchedulerJob(new PgPayoutSchedulerAdapter(pool))

    await job.runOnce()

    expect((await payoutStatusOf(pendingOrderId)).status).toBe('due')
    expect((await payoutStatusOf(disputedOrderId)).status).toBe('disputed')
    expect((await payoutStatusOf(alreadyDueOrderId)).status).toBe('due')
  })
})
