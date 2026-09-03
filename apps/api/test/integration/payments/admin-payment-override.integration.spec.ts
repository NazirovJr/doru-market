/**
 * Интеграционный тест `AdminPaymentOverrideUseCase` (EP-10, DTJ-246) — РЕАЛЬНЫЙ Postgres, тот
 * же `createTestApp()` харнесс. Тест-план тикета: «реальная транзакция, audit_log запись
 * проверена через прямой SQL-запрос».
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AdminPaymentOverrideUseCase } from '@/modules/payments/application/use-cases/admin-payment-override.use-case.js'
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

describe.skipIf(!postgresAvailable)('AdminPaymentOverrideUseCase — integration (DTJ-246)', () => {
  let pool: Pool
  let testApp: TestApp
  let useCase: AdminPaymentOverrideUseCase
  let tenantId: string
  let customerId: string
  let pharmacyId: string
  const createdOrderIds: string[] = []
  let orderNumberSeq = 0

  beforeAll(async () => {
    testApp = await createTestApp()
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    useCase = testApp.app.get(AdminPaymentOverrideUseCase)

    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj246-${tenantId.slice(0, 8)}`])
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
    pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-246 Test Pharmacy', 'x', 38.5, 68.7, '+992900000005')`,
      [pharmacyId],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
    await testApp.close()
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM audit_log WHERE entity_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM escrow_ledger WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
  })

  async function seedOrder(): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'pending_payment', 'alif_mobi', 150.00, 0.00, 150.00, 'x', $5, $6)`,
      [orderId, `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`, customerId, pharmacyId, tenantId, randomUUID()],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('AC1: super_admin с валидным reason → заказ pending_payment -> paid_escrow, escrow_ledger(hold_created), audit_log(payment_override) с reason/actor_user_id', async () => {
    const orderId = await seedOrder()

    await useCase.execute({
      tenantId,
      orderId,
      txId: 'manual-tx-integration-1',
      amountDiram: 15_000n,
      paidAt: new Date(),
      reason: 'confirmed by bank support over phone, ref #DTJ246',
      actorUserId: customerId, // FK на users — переиспользуем seed-пользователя как "администратора" для теста
      actorRole: 'super_admin',
    })

    const orderRow = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(orderRow.rows[0]?.status).toBe('paid_escrow')

    const ledgerRows = await pool.query<{ entry_type: string; amount_diram: string }>(
      'SELECT entry_type, amount_diram FROM escrow_ledger WHERE order_id = $1',
      [orderId],
    )
    expect(ledgerRows.rows).toHaveLength(1)
    expect(ledgerRows.rows[0]).toMatchObject({ entry_type: 'hold_created', amount_diram: '15000' })

    const auditRows = await pool.query<{ reason: string; actor_user_id: string; category: string }>(
      `SELECT reason, actor_user_id, category FROM audit_log WHERE entity_id = $1 AND category = 'payment_override'`,
      [orderId],
    )
    expect(auditRows.rows).toHaveLength(1)
    expect(auditRows.rows[0]).toMatchObject({ actor_user_id: customerId, category: 'payment_override' })
    expect(auditRows.rows[0]?.reason).toContain('DTJ246')
  })
})
