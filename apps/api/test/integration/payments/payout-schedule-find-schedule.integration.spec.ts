/**
 * Интеграционный тест `DrizzlePayoutScheduleRepository.findSchedule` (DTJ-357, review) —
 * реальный Postgres, платформенная очередь `admin` (без `pharmacyId`, фильтры `status`/
 * `pharmacyId` опциональны). Тот же приём подключения, что `escrow-ledger.repository.
 * integration.spec.ts` (DTJ-240) — repository напрямую, не через HTTP.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { DrizzlePayoutScheduleRepository } from '@/modules/payments/infrastructure/repositories/payout-schedule.repository.js'

const TEST_DATABASE_URL =
  process.env.PAYMENTS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
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

describe.skipIf(!postgresAvailable)('DrizzlePayoutScheduleRepository.findSchedule (DTJ-357)', () => {
  let pool: Pool
  let repository: DrizzlePayoutScheduleRepository
  const tenantId = randomUUID()
  const chainId = randomUUID()
  let pharmacyAId: string
  let pharmacyBId: string
  let customerId: string
  const createdOrderIds: string[] = []

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    repository = new DrizzlePayoutScheduleRepository(drizzle(pool))

    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj357-ps-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
    await pool.query(`INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn) VALUES ($1, 'Chain', 'Chain LLC', $2)`, [
      chainId,
      `tin-${chainId.slice(0, 8)}`,
    ])
    pharmacyAId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone) VALUES ($1, $2, 'Pharmacy A', 'addr', 38.5, 68.7, '+992900000011')`,
      [pharmacyAId, chainId],
    )
    pharmacyBId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, chain_id, name, address_text, latitude, longitude, phone) VALUES ($1, $2, 'Pharmacy B', 'addr', 38.5, 68.7, '+992900000012')`,
      [pharmacyBId, chainId],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacies WHERE chain_id = $1', [chainId])
    await pool.query('DELETE FROM pharmacy_chains WHERE id = $1', [chainId])
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM payout_schedule WHERE order_id = $1', [orderId])
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    }
  })

  let orderNumberSeq = 0
  function nextOrderNumber(): string {
    orderNumberSeq += 1
    return `DTJ357-${String(orderNumberSeq).padStart(5, '0')}`
  }

  async function seedPayout(pharmacyId: string, status: string): Promise<string> {
    const orderId = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, payment_method, status, items_total_tjs,
          delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'alif_mobi', 'delivered', 200.00, 0.00, 200.00, 'x', $5, gen_random_uuid())`,
      [orderId, nextOrderNumber(), customerId, pharmacyId, tenantId],
    )
    await pool.query(
      `INSERT INTO payout_schedule (id, order_id, pharmacy_id, status, gross_amount_diram, commission_diram, net_amount_diram, hold_period_days)
       VALUES (gen_random_uuid(), $1, $2, $3, 20000, 1600, 18400, 1)`,
      [orderId, pharmacyId, status],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('без фильтров — видит выплаты ОБЕИХ аптек (платформенная очередь, без pharmacyId)', async () => {
    const orderA = await seedPayout(pharmacyAId, 'due')
    const orderB = await seedPayout(pharmacyBId, 'pending')

    const page = await repository.findSchedule({ limit: 20, cursor: null })

    const orderIds = page.items.map((row) => row.orderId)
    expect(orderIds).toEqual(expect.arrayContaining([orderA, orderB]))
  })

  it('filter.status сужает до совпадающего статуса', async () => {
    const dueOrder = await seedPayout(pharmacyAId, 'due')
    await seedPayout(pharmacyAId, 'paid')

    const page = await repository.findSchedule({ status: 'due', limit: 20, cursor: null })

    expect(page.items.some((row) => row.orderId === dueOrder)).toBe(true)
    expect(page.items.every((row) => row.status === 'due')).toBe(true)
  })

  it('filter.pharmacyId сужает до конкретной аптеки', async () => {
    const orderA = await seedPayout(pharmacyAId, 'due')
    const orderB = await seedPayout(pharmacyBId, 'due')

    const page = await repository.findSchedule({ pharmacyId: pharmacyAId, limit: 20, cursor: null })

    const orderIds = page.items.map((row) => row.orderId)
    expect(orderIds).toContain(orderA)
    expect(orderIds).not.toContain(orderB)
  })
})
