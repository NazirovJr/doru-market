/**
 * Интеграционный тест DTJ-243 (EP-10, SRS-PAY-025/028/040) — против РЕАЛЬНОГО Postgres, тот же
 * `createTestApp()` харнесс, что `handle-payment-webhook.integration.spec.ts` (DTJ-242).
 * Фокус — код-пути, невыразимые на моках: raw SQL адаптеров (`RawSqlSupportTicketRepository`/
 * `RawSqlAuditLogRepository`/новые методы `DrizzlePaymentWebhookOperationsRepository`) —
 * синтаксис/биндинг типов SQL-строк проверяется ТОЛЬКО реальной БД, юнит-моки этого не ловят.
 */
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY,
  type PaymentWebhookOperationsPort,
} from '@/modules/payments/application/ports/payment-webhook-operations.port.js'
import { SUPPORT_TICKET_PORT, type SupportTicketPort } from '@/modules/payments/application/ports/support-ticket.port.js'
import { AUDIT_LOG_PORT, type AuditLogPort } from '@/modules/payments/application/ports/audit-log.port.js'
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

describe.skipIf(!postgresAvailable)('DTJ-243 webhook edge cases — integration', () => {
  let pool: Pool
  let testApp: TestApp
  let webhookOperations: PaymentWebhookOperationsPort
  let supportTickets: SupportTicketPort
  let auditLog: AuditLogPort
  let tenantId: string
  let customerId: string
  let pharmacyId: string
  const createdOrderIds: string[] = []
  const createdTicketIds: string[] = []
  let orderNumberSeq = 0

  beforeAll(async () => {
    testApp = await createTestApp()
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    webhookOperations = testApp.app.get(PAYMENT_WEBHOOK_OPERATIONS_REPOSITORY)
    supportTickets = testApp.app.get(SUPPORT_TICKET_PORT)
    auditLog = testApp.app.get(AUDIT_LOG_PORT)

    tenantId = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [tenantId, `dtj243-${tenantId.slice(0, 8)}`])
    pharmacyId = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone) VALUES ($1, 'DTJ-243 Test Pharmacy', 'x', 38.5, 68.7, '+992900000003')`,
      [pharmacyId],
    )
    customerId = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, 'customer')`, [customerId, tenantId])
  })

  afterAll(async () => {
    for (const ticketId of createdTicketIds) {
      await pool.query('DELETE FROM support_tickets WHERE id = $1', [ticketId]).catch(() => undefined)
    }
    await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenantId]).catch(() => undefined)
    await pool
      .query(`DELETE FROM audit_log WHERE action = 'unknown_payment_webhook' AND metadata->>'providerRef' = 'ref-unknown-x'`)
      .catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [customerId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined)
    await pool.end().catch(() => undefined)
    await testApp.close()
  })

  afterEach(async () => {
    for (const orderId of createdOrderIds.splice(0)) {
      await pool.query('DELETE FROM payment_operations WHERE order_id = $1', [orderId]).catch(() => undefined)
      await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => undefined)
    }
  })

  async function seedOrder(deletedAt: Date | null = null): Promise<string> {
    const orderId = randomUUID()
    orderNumberSeq += 1
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address,
          tenant_id, checkout_attempt_id, deleted_at)
       VALUES ($1, $2, $3, $4, 'pending_payment', 'alif_mobi', 20.00, 5.00, 25.00, 'x', $5, $6, $7)`,
      [orderId, `DTJ-260904-${String(orderNumberSeq).padStart(5, '0')}`, customerId, pharmacyId, tenantId, randomUUID(), deletedAt],
    )
    createdOrderIds.push(orderId)
    return orderId
  }

  it('SRS-PAY-040: findOrderByProviderRef игнорирует soft-deleted заказ (deleted_at IS NOT NULL) — трактуется как несуществующий', async () => {
    const orderId = await seedOrder(new Date())
    const providerRef = `ref-${orderId}`
    await pool.query(
      `INSERT INTO payment_operations (order_id, operation_type, idempotency_key, provider, provider_ref, status, amount_diram)
       VALUES ($1, 'create_bill', $2, 'mock_bank', $2, 'pending', 20000)`,
      [orderId, providerRef],
    )

    const result = await webhookOperations.findOrderByProviderRef(providerRef)

    expect(result).toBeNull()
  })

  it('обычный (не удалённый) заказ по-прежнему резолвится через findOrderByProviderRef', async () => {
    const orderId = await seedOrder(null)
    const providerRef = `ref-${orderId}`
    await pool.query(
      `INSERT INTO payment_operations (order_id, operation_type, idempotency_key, provider, provider_ref, status, amount_diram)
       VALUES ($1, 'create_bill', $2, 'mock_bank', $2, 'pending', 20000)`,
      [orderId, providerRef],
    )

    const result = await webhookOperations.findOrderByProviderRef(providerRef)

    expect(result).toEqual({ orderId, tenantId })
  })

  it('SRS-PAY-025: findRefundOperationRef находит РАНЕЕ созданную refund-операцию по providerRef (независимо от status)', async () => {
    const orderId = await seedOrder(null)
    const refundProviderRef = `refund-${orderId}`
    await pool.query(
      `INSERT INTO payment_operations (order_id, operation_type, idempotency_key, provider, provider_ref, status, amount_diram)
       VALUES ($1, 'refund', $2, 'mock_bank', $2, 'succeeded', 20000)`,
      [orderId, refundProviderRef],
    )

    const result = await webhookOperations.findRefundOperationRef(refundProviderRef)

    expect(result).toEqual({ orderId, tenantId })
  })

  it('findRefundOperationRef НЕ находит create_bill-операцию (только refund/partial_refund) — тот же providerRef, другой operation_type', async () => {
    const orderId = await seedOrder(null)
    const providerRef = `ref-${orderId}`
    await pool.query(
      `INSERT INTO payment_operations (order_id, operation_type, idempotency_key, provider, provider_ref, status, amount_diram)
       VALUES ($1, 'create_bill', $2, 'mock_bank', $2, 'succeeded', 20000)`,
      [orderId, providerRef],
    )

    const result = await webhookOperations.findRefundOperationRef(providerRef)

    expect(result).toBeNull()
  })

  it('RawSqlSupportTicketRepository.createSystemAutoTicket реально вставляет строку support_tickets', async () => {
    const { ticketId } = await supportTickets.createSystemAutoTicket({
      tenantId,
      orderId: null,
      category: 'payment_issue',
      description: 'DTJ-243 integration test ticket',
    })
    createdTicketIds.push(ticketId)

    const row = await pool.query<{ channel: string; category: string; tenant_id: string; order_id: string | null }>(
      'SELECT channel, category, tenant_id, order_id FROM support_tickets WHERE id = $1',
      [ticketId],
    )
    expect(row.rows[0]).toMatchObject({ channel: 'system_auto', category: 'payment_issue', tenant_id: tenantId, order_id: null })
  })

  it('RawSqlAuditLogRepository.appendPaymentOverride реально вставляет строку audit_log с tenantId=null и суррогатным entity_id (неизвестный платёж)', async () => {
    await auditLog.appendPaymentOverride({
      tenantId: null,
      entityId: null,
      action: 'unknown_payment_webhook',
      metadata: { providerRef: 'ref-unknown-x', bankEventId: 'evt-unknown-x' },
    })

    const rows = await pool.query<{ entity_type: string; tenant_id: string | null; action: string; metadata: { providerRef: string } }>(
      `SELECT entity_type, tenant_id, action, metadata FROM audit_log WHERE action = 'unknown_payment_webhook' AND metadata->>'providerRef' = 'ref-unknown-x'`,
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ entity_type: 'payment_webhook_event', tenant_id: null })
    expect(rows.rows[0]?.metadata.providerRef).toBe('ref-unknown-x')
  })
})
