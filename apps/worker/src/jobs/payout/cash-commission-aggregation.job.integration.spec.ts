/**
 * Интеграционный тест `CashCommissionAggregationJob` (DTJ-251, TC-PAY-012 буквально +
 * идемпотентность AC2) — РЕАЛЬНЫЙ Postgres, тот же приём, что `payout-scheduler.job.
 * integration.spec.ts` (DTJ-249): `describe.skipIf(!postgresAvailable)`, прямой `pg.Pool`,
 * `PgCashCommissionAggregationAdapter` без апи/Nest-обвязки.
 *
 * Сценарий TC-PAY-012: 5 `cash_courier`-заказов `delivered` за одну неделю (Пн/Ср/Пт) у ОДНОЙ
 * сети — три ежедневных тика (по одному на каждый день с заказами) + один еженедельный issue.
 * Даты фикстур/границ выведены вручную (Asia/Dushanbe = UTC+5) и независимо перепроверены
 * прогоном `cash-commission-aggregation.util.ts` (см. отчёт сдачи).
 *
 * `order_number` — `uniqueOrderNumber()` (`randomUUID()`-based), НЕ литеральный `DTJ-260904-
 * NNNNN`: `apps/worker`'s `vitest run` не сериализует файлы (в отличие от `apps/api`'s
 * `vitest.integration.config.ts`), а `orders.order_number` глобально `UNIQUE` — несколько
 * `*.integration.spec.ts`-файлов с ОДНИМ литеральным префиксом и счётчиком от 1 конкурентно
 * дают `duplicate key value violates unique constraint "orders_order_number_key"` (найдено
 * живым прогоном `pnpm verify` этого тикета — см. тот же фикс `payout-scheduler.job.
 * integration.spec.ts`, DTJ-249, отчёт сдачи).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CashCommissionAggregationJob } from './cash-commission-aggregation.job.js'
import { PgCashCommissionAggregationAdapter } from './pg-cash-commission-aggregation.adapter.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test3'
const PROBE_TIMEOUT_MS = 1_500
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

// Неделя понедельник 2026-01-05 .. воскресенье 2026-01-11 (реальные даты, проверено
// Date.UTC(2026,0,5).getUTCDay()===1). Полдень Dushanbe = 07:00 UTC (безопасно внутри суток,
// без риска пересечь границу дня).
const MONDAY_ORDER_AT = new Date('2026-01-05T07:00:00Z')
const WEDNESDAY_ORDER_AT = new Date('2026-01-07T07:00:00Z')
const FRIDAY_ORDER_AT = new Date('2026-01-09T07:00:00Z')
// «Теперь» ежедневного тика — 00:30 Dushanbe СЛЕДУЮЩИХ суток после каждого дня с заказами.
const NOW_TUESDAY_TICK = new Date('2026-01-05T19:30:00Z')
const NOW_THURSDAY_TICK = new Date('2026-01-07T19:30:00Z')
const NOW_SATURDAY_TICK = new Date('2026-01-09T19:30:00Z')
// Еженедельный issue — воскресенье 23:50 Dushanbe ТОЙ ЖЕ недели (см. JSDoc scheduler'а).
const NOW_WEEKLY_ISSUE = new Date('2026-01-11T18:50:00Z')
const EXPECTED_PERIOD_START = new Date('2026-01-04T19:00:00.000Z') // понедельник 00:00 Dushanbe

describe.skipIf(!postgresAvailable)('CashCommissionAggregationJob — integration (DTJ-251, TC-PAY-012)', () => {
  let pool: Pool
  let job: CashCommissionAggregationJob
  let chainId: string
  let pharmacyId: string
  let tenantId: string
  let customerId: string
  const createdOrderIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    job = new CashCommissionAggregationJob(new PgCashCommissionAggregationAdapter(pool))

    chainId = randomUUID()
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, $2, $2, $3)`, [
      chainId,
      `DTJ-251 Chain ${chainId.slice(0, 8)}`,
      `TIN-${chainId.slice(0, 12)}`,
    ])
    pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone, chain_id) VALUES ($1, 'DTJ-251 Test Pharmacy', 'x', 38.5, 68.7, '+992900000251', $2)`,
      [pharmacyId, chainId],
    )
    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj251-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
    await pool.query('DELETE FROM platform_billing_invoices WHERE chain_id = $1', [chainId]).catch(() => undefined)
    await pool.query(`DELETE FROM processed_events WHERE consumer_name = 'cash-commission-aggregation'`).catch(() => undefined)
  })

  async function seedCashOrder(deliveredAt: Date, platformFeeDiram: bigint): Promise<string> {
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method, delivered_at,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'delivered', 'cash_courier', $5, 200.00, 0.00, 200.00, 'Dushanbe, Rudaki 1', $6, $7)`,
      [orderId, uniqueOrderNumber(), customerId, pharmacyId, deliveredAt, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO order_items (id, order_id, unit_price_tjs, quantity, total_price_tjs, commission_bps, platform_fee_diram)
       VALUES (gen_random_uuid(), $1, 200.00, 1, 200.00, 800, $2)`,
      [orderId, platformFeeDiram],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  async function invoiceRow(): Promise<{ status: string; subtotal_diram: string; vat_diram: string; total_diram: string } | undefined> {
    const result = await pool.query<{ status: string; subtotal_diram: string; vat_diram: string; total_diram: string }>(
      `SELECT status, subtotal_diram, vat_diram, total_diram FROM platform_billing_invoices WHERE chain_id = $1 AND invoice_type = 'cash_courier_commission'`,
      [chainId],
    )
    return result.rows[0]
  }

  it('TC-PAY-012: 5 cash_courier заказов delivered за неделю у одной сети → subtotal=Σ(fee), draft→issued с vat=subtotal×0.14', async () => {
    await seedCashOrder(MONDAY_ORDER_AT, 1_000n)
    await seedCashOrder(MONDAY_ORDER_AT, 2_000n)
    await seedCashOrder(WEDNESDAY_ORDER_AT, 1_500n)
    await seedCashOrder(WEDNESDAY_ORDER_AT, 500n)
    await seedCashOrder(FRIDAY_ORDER_AT, 3_000n)

    await job.runDailyAggregation(NOW_TUESDAY_TICK)
    await job.runDailyAggregation(NOW_THURSDAY_TICK)
    await job.runDailyAggregation(NOW_SATURDAY_TICK)

    const draft = await invoiceRow()
    expect(draft).toMatchObject({ status: 'draft', subtotal_diram: '8000', vat_diram: '0', total_diram: '8000' })

    const issueResult = await job.runWeeklyIssue(NOW_WEEKLY_ISSUE)

    expect(issueResult).toEqual({ issued: 1 })
    const issued = await invoiceRow()
    expect(issued).toMatchObject({ status: 'issued', subtotal_diram: '8000', vat_diram: '1120', total_diram: '9120' }) // 8000×0.14=1120 точно, без остатка
    const periodRow = await pool.query<{ period_start: Date }>('SELECT period_start FROM platform_billing_invoices WHERE chain_id = $1', [chainId])
    expect(periodRow.rows[0]?.period_start).toEqual(EXPECTED_PERIOD_START)
  })

  it('AC2: повторный прогон ежедневной агрегации за ТУ ЖЕ дату — subtotal НЕ удваивается', async () => {
    await seedCashOrder(MONDAY_ORDER_AT, 1_000n)

    const first = await job.runDailyAggregation(NOW_TUESDAY_TICK)
    const second = await job.runDailyAggregation(NOW_TUESDAY_TICK) // тот же now — тот же ключ идемпотентности

    expect(first).toEqual({ chainsProcessed: 1, skippedDuplicates: 0 })
    expect(second).toEqual({ chainsProcessed: 0, skippedDuplicates: 1 })
    const draft = await invoiceRow()
    expect(draft?.subtotal_diram).toBe('1000') // НЕ '2000'
  })

  it('AC4: сеть без единого cash_courier-заказа за сутки — ни одна строка platform_billing_invoices не создаётся', async () => {
    const result = await job.runDailyAggregation(NOW_TUESDAY_TICK)

    expect(result).toEqual({ chainsProcessed: 0, skippedDuplicates: 0 })
    expect(await invoiceRow()).toBeUndefined()
  })

  it('заказ non-cash (alif_mobi) delivered в том же окне — НЕ попадает в агрегацию (только cash_courier)', async () => {
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method, delivered_at,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'delivered', 'alif_mobi', $5, 200.00, 0.00, 200.00, 'Dushanbe, Rudaki 1', $6, $7)`,
      [orderId, uniqueOrderNumber(), customerId, pharmacyId, MONDAY_ORDER_AT, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO order_items (id, order_id, unit_price_tjs, quantity, total_price_tjs, commission_bps, platform_fee_diram)
       VALUES (gen_random_uuid(), $1, 200.00, 1, 200.00, 800, 9999)`,
      [orderId],
    )
    createdOrderIds.push(orderId)

    await job.runDailyAggregation(NOW_TUESDAY_TICK)

    expect(await invoiceRow()).toBeUndefined()
  })
})
