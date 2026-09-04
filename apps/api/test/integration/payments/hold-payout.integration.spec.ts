/**
 * Интеграционный тест `HoldPayoutUseCase` (EP-10, DTJ-249, AC2/AC3) — РЕАЛЬНЫЙ Postgres, тот же
 * `createTestApp()` харнесс, что `capture-escrow.integration.spec.ts`. Фокус — реальный `UPDATE`
 * через `DrizzlePayoutScheduleRepository.holdIfPending` (тенант-скоуп через `EXISTS`-подзапрос
 * против `orders`, невыразимо на моках).
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HoldPayoutUseCase } from '@/modules/payments/application/use-cases/hold-payout.use-case.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

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

describe.skipIf(!postgresAvailable)('HoldPayoutUseCase — integration (DTJ-249)', () => {
  let pool: Pool
  let testApp: TestApp
  let useCase: HoldPayoutUseCase
  let tenantId: string
  let customerId: string
  let pharmacyId: string
  const createdOrderIds: string[] = []
  let orderNumberSeq = 0

  beforeAll(async () => {
    testApp = await createTestApp()
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    useCase = testApp.app.get(HoldPayoutUseCase)

    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj249h-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
    pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-249 Hold Test Pharmacy', 'x', 38.5, 68.7, '+992900000250')`,
      [pharmacyId],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
    await testApp.close()
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM payout_schedule WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
  })

  async function seedOrderWithPayout(payoutStatus: string): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'delivered', 'alif_mobi', 200.00, 0.00, 200.00, 'Dushanbe, Rudaki 1', $5, $6)`,
      [orderId, `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`, customerId, pharmacyId, tenantId, randomUUID()],
    )
    await pool.query(
      `INSERT INTO payout_schedule
         (id, order_id, pharmacy_id, status, gross_amount_diram, commission_diram, net_amount_diram, hold_period_days)
       VALUES (gen_random_uuid(), $1, $2, $3, 20000, 1600, 18400, 1)`,
      [orderId, pharmacyId, payoutStatus],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  async function payoutRowOf(orderId: string): Promise<{ status: string; held_by_dispute_id: string | null }> {
    const result = await pool.query<{ status: string; held_by_dispute_id: string | null }>(
      'SELECT status, held_by_dispute_id FROM payout_schedule WHERE order_id = $1',
      [orderId],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error(`payoutRowOf: no payout_schedule row for order ${orderId}`)
    return row
  }

  it('AC2: status=\'pending\' → disputed, held_by_dispute_id заполнен, alreadyPaid=false', async () => {
    const orderId = await seedOrderWithPayout('pending')
    const disputeId = randomUUID()

    const result = await useCase.execute({ tenantId, orderId, disputeId })

    expect(result).toEqual({ alreadyPaid: false })
    const row = await payoutRowOf(orderId)
    expect(row.status).toBe('disputed')
    expect(row.held_by_dispute_id).toBe(disputeId)
  })

  it('AC2: status=\'due\' → disputed, held_by_dispute_id заполнен, alreadyPaid=false', async () => {
    const orderId = await seedOrderWithPayout('due')
    const disputeId = randomUUID()

    const result = await useCase.execute({ tenantId, orderId, disputeId })

    expect(result).toEqual({ alreadyPaid: false })
    expect((await payoutRowOf(orderId)).status).toBe('disputed')
  })

  it('AC3: status=\'paid\' (пост-payout) → статус НЕ изменён, alreadyPaid=true, ошибка не брошена', async () => {
    const orderId = await seedOrderWithPayout('paid')
    const disputeId = randomUUID()

    const result = await useCase.execute({ tenantId, orderId, disputeId })

    expect(result).toEqual({ alreadyPaid: true })
    const row = await payoutRowOf(orderId)
    expect(row.status).toBe('paid')
    expect(row.held_by_dispute_id).toBeNull()
  })

  it('чужой tenantId — та же ветка alreadyPaid=true (заказ «не найден» для чужого тенанта, SRS-API-046), статус не изменён', async () => {
    const orderId = await seedOrderWithPayout('pending')
    const foreignTenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [foreignTenantId, `dtj249h-foreign-${foreignTenantId.slice(0, 8)}`])

    try {
      const result = await useCase.execute({ tenantId: foreignTenantId, orderId, disputeId: randomUUID() })

      expect(result).toEqual({ alreadyPaid: true })
      expect((await payoutRowOf(orderId)).status).toBe('pending')
    } finally {
      await pool.query('DELETE FROM tenants WHERE id = $1', [foreignTenantId]).catch(() => undefined)
    }
  })
})
