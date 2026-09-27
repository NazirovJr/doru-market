// Полный проход assigned -> ... -> delivered на РЕАЛЬНОМ стенде (createTestApp): OrdersFacade.verifyHandoverOtp — единственный механизм OTP (DTJ-306/317 волна 8), не фейки.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CashAmountMismatchError, ErrorCode, OtpMismatchError } from '@dorutj/contracts'
import { JWT_SIGNER, type JwtSignerPort } from '@/modules/auth/index.js'
import { DepartUseCase } from '@/modules/delivery/application/use-cases/depart.use-case.js'
import { DepartToCustomerUseCase } from '@/modules/delivery/application/use-cases/depart-to-customer.use-case.js'
import { RecordCashUseCase } from '@/modules/delivery/application/use-cases/record-cash.use-case.js'
import { DeliverUseCase } from '@/modules/delivery/application/use-cases/deliver.use-case.js'
import { ReissueHandoverOtpUseCase } from '@/modules/delivery/application/use-cases/reissue-handover-otp.use-case.js'
import { createTestApp, type TestApp } from './__tests__/test-app.js'

const TEST_DATABASE_URL =
  process.env.DELIVERY_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const OTP_CODE = '4821'

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

describe.skipIf(!postgresAvailable)('depart -> depart-to-customer -> record-cash -> deliver (DTJ-317, волна 8)', () => {
  let pool: Pool
  let testApp: TestApp
  let jwtSigner: JwtSignerPort

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    testApp = await createTestApp()
    jwtSigner = testApp.app.get<JwtSignerPort>(JWT_SIGNER)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
    await testApp.close()
  })

  async function seedTenant(): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj317-${id.slice(0, 8)}`])
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-317', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000005')`,
      [id],
    )
    return id
  }

  async function seedUser(tenantId: string, role: string): Promise<string> {
    const id = randomUUID()
    await pool.query(`INSERT INTO users (id, tenant_id, role) VALUES ($1, $2, $3)`, [id, tenantId, role])
    return id
  }

  async function seedCourier(tenantId: string): Promise<{ courierId: string; userId: string }> {
    const userId = await seedUser(tenantId, 'courier')
    const courierId = randomUUID()
    await pool.query(
      `INSERT INTO couriers (id, user_id, status, tax_status, vehicle_type, shift_status)
       VALUES ($1, $2, 'active', 'individual_patent', 'car', 'on_shift')`,
      [courierId, userId],
    )
    return { courierId, userId }
  }

  async function seedShift(courierId: string): Promise<void> {
    await pool.query(
      `INSERT INTO courier_shifts (id, courier_id, status, opening_cash_on_hand_diram, cash_collected_diram)
       VALUES (gen_random_uuid(), $1, 'active', 0, 0)`,
      [courierId],
    )
  }

  async function seedOrder(tenantId: string, pharmacyId: string, customerId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'picked_up', 'cash_courier', 55, 5, 60, 'Dushanbe, Rudaki 1', $5, $6)`,
      [id, nextOrderNumber(), customerId, pharmacyId, tenantId, randomUUID()],
    )
    return id
  }

  function nextOrderNumber(): string {
    const seq = Number(process.hrtime.bigint() % 100000n)
    return `DTJ-260925-${String(seq).padStart(5, '0')}`
  }

  async function seedHandoverOtp(tenantId: string, orderId: string, code: string): Promise<string> {
    const otpId = randomUUID()
    const { createHash } = await import('node:crypto')
    const codeHash = createHash('sha256').update(`${code}:${otpId}`).digest('hex').slice(0, 64)
    // issued_at — в прошлом (не NOW()): reissue-тест иначе упирается в handover_otp_regenerate_min_interval_seconds (дефолт 60с).
    await pool.query(
      `INSERT INTO otp_codes (id, tenant_id, subject_ref, purpose, code_hash, plain_code, issued_at, expires_at)
       VALUES ($1, $2, $3, 'delivery_handover', $4, $5, NOW() - interval '2 hours', NOW() + interval '900 seconds')`,
      [otpId, tenantId, orderId, codeHash, code],
    )
    await pool.query(`UPDATE orders SET handover_otp_id = $2 WHERE id = $1`, [orderId, otpId])
    return otpId
  }

  async function seedAssignment(orderId: string, courierId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO delivery_assignments (id, order_id, courier_id, status, requires_cold_chain, assigned_at)
       VALUES ($1, $2, $3, 'assigned', false, NOW())`,
      [id, orderId, courierId],
    )
    return id
  }

  async function cleanup(input: {
    assignmentId: string
    orderId: string
    otpIds: readonly string[]
    courierId: string
    courierUserId: string
    customerId: string
    pharmacyId: string
    tenantId: string
  }): Promise<void> {
    await pool.query('DELETE FROM courier_earnings WHERE delivery_assignment_id = $1', [input.assignmentId]).catch(() => undefined)
    await pool.query('DELETE FROM delivery_assignments WHERE id = $1', [input.assignmentId]).catch(() => undefined)
    await pool.query('DELETE FROM courier_shifts WHERE courier_id = $1', [input.courierId]).catch(() => undefined)
    for (const otpId of input.otpIds) {
      await pool.query('DELETE FROM otp_codes WHERE id = $1', [otpId]).catch(() => undefined)
    }
    await pool.query('DELETE FROM orders WHERE id = $1', [input.orderId]).catch(() => undefined)
    await pool.query('DELETE FROM couriers WHERE id = $1', [input.courierId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [input.courierUserId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [input.customerId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [input.pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [input.tenantId]).catch(() => undefined)
  }

  it('assigned -> en_route_to_pharmacy -> picked_up_from_pharmacy -> en_route_to_customer -> delivered (TC-DELIV-009..013, реальный OrdersFacade)', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedUser(tenantId, 'customer')
    const { courierId, userId: courierUserId } = await seedCourier(tenantId)
    await seedShift(courierId)
    const orderId = await seedOrder(tenantId, pharmacyId, customerId)
    const otpId = await seedHandoverOtp(tenantId, orderId, OTP_CODE)
    const assignmentId = await seedAssignment(orderId, courierId)

    const depart = testApp.app.get(DepartUseCase)
    const departToCustomer = testApp.app.get(DepartToCustomerUseCase)
    const recordCash = testApp.app.get(RecordCashUseCase)
    const deliver = testApp.app.get(DeliverUseCase)

    await depart.execute({ assignmentId, userId: courierUserId })
    const afterDepart = await pool.query<{ status: string }>('SELECT status FROM delivery_assignments WHERE id = $1', [assignmentId])
    expect(afterDepart.rows[0]?.status).toBe('en_route_to_pharmacy')

    await departToCustomer.execute({ assignmentId, userId: courierUserId })
    const afterDeparted = await pool.query<{ status: string; handover_otp_id: string }>(
      'SELECT status, handover_otp_id FROM delivery_assignments WHERE id = $1',
      [assignmentId],
    )
    expect(afterDeparted.rows[0]?.status).toBe('en_route_to_customer')
    expect(afterDeparted.rows[0]?.handover_otp_id).toBe(otpId)

    await expect(recordCash.execute({ assignmentId, userId: courierUserId, collectedDiram: 6000, changeDiram: 500 })).rejects.toBeInstanceOf(
      CashAmountMismatchError,
    )
    await recordCash.execute({ assignmentId, userId: courierUserId, collectedDiram: 6000, changeDiram: 0 })
    const courierRow = await pool.query<{ current_cash_on_hand_diram: string }>(
      'SELECT current_cash_on_hand_diram FROM couriers WHERE id = $1',
      [courierId],
    )
    expect(courierRow.rows[0]?.current_cash_on_hand_diram).toBe('6000')

    await expect(deliver.execute({ assignmentId, userId: courierUserId, otpCode: '0000' })).rejects.toBeInstanceOf(OtpMismatchError)

    await deliver.execute({ assignmentId, userId: courierUserId, otpCode: OTP_CODE })
    const delivered = await pool.query<{ status: string }>('SELECT status FROM delivery_assignments WHERE id = $1', [assignmentId])
    expect(delivered.rows[0]?.status).toBe('delivered')
    const earningsRows = await pool.query<{ amount_diram: string }>(
      'SELECT amount_diram FROM courier_earnings WHERE delivery_assignment_id = $1',
      [assignmentId],
    )
    expect(earningsRows.rows).toHaveLength(1)
    expect(earningsRows.rows[0]?.amount_diram).toBe('500')
    const orderRow = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId])
    expect(orderRow.rows[0]?.status).toBe('delivered')

    // TC-DELIV-075 — дубль ПОСЛЕ успеха: OTP уже consumed через orders -> OTP_MISMATCH, не 500.
    await expect(deliver.execute({ assignmentId, userId: courierUserId, otpCode: OTP_CODE })).rejects.toBeInstanceOf(OtpMismatchError)

    await cleanup({ assignmentId, orderId, otpIds: [otpId], courierId, courierUserId, customerId, pharmacyId, tenantId })
  })

  it('TC-DELIV-012: cash_courier, recordCash НЕ вызван -> deliver отклоняет (CashAmountMismatchError)', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedUser(tenantId, 'customer')
    const { courierId, userId: courierUserId } = await seedCourier(tenantId)
    await seedShift(courierId)
    const orderId = await seedOrder(tenantId, pharmacyId, customerId)
    const otpId = await seedHandoverOtp(tenantId, orderId, OTP_CODE)
    const assignmentId = await seedAssignment(orderId, courierId)
    await pool.query(
      `UPDATE delivery_assignments SET status = 'en_route_to_customer', handover_otp_id = $2, picked_up_from_pharmacy_at = NOW() WHERE id = $1`,
      [assignmentId, otpId],
    )

    const deliver = testApp.app.get(DeliverUseCase)
    await expect(deliver.execute({ assignmentId, userId: courierUserId, otpCode: OTP_CODE })).rejects.toBeInstanceOf(CashAmountMismatchError)

    await cleanup({ assignmentId, orderId, otpIds: [otpId], courierId, courierUserId, customerId, pharmacyId, tenantId })
  })

  it('reissue-handover-otp: новый код переключает И orders.handover_otp_id, И копию на delivery_assignments — deliver старым кодом отклоняется, новым проходит', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedUser(tenantId, 'customer')
    const { courierId, userId: courierUserId } = await seedCourier(tenantId)
    await seedShift(courierId)
    const orderId = await seedOrder(tenantId, pharmacyId, customerId)
    const oldOtpId = await seedHandoverOtp(tenantId, orderId, OTP_CODE)
    const assignmentId = await seedAssignment(orderId, courierId)
    await pool.query(
      `UPDATE delivery_assignments SET status = 'en_route_to_customer', handover_otp_id = $2, picked_up_from_pharmacy_at = NOW() WHERE id = $1`,
      [assignmentId, oldOtpId],
    )
    await pool.query(`UPDATE couriers SET current_cash_on_hand_diram = 6000 WHERE id = $1`, [courierId])
    await pool.query(`UPDATE delivery_assignments SET cash_collected_diram = 6000, cash_change_diram = 0 WHERE id = $1`, [assignmentId])
    const supportAgentUserId = await seedUser(tenantId, 'support_agent') // audit_log.actor_user_id -> users FK

    const reissue = testApp.app.get(ReissueHandoverOtpUseCase)
    const deliver = testApp.app.get(DeliverUseCase)
    const result = await reissue.execute({
      assignmentId,
      actor: { userId: supportAgentUserId, role: 'support_agent', tenantId, pharmacyId: null },
    })

    const orderRow = await pool.query<{ handover_otp_id: string }>('SELECT handover_otp_id FROM orders WHERE id = $1', [orderId])
    const assignmentRow = await pool.query<{ handover_otp_id: string }>('SELECT handover_otp_id FROM delivery_assignments WHERE id = $1', [
      assignmentId,
    ])
    expect(orderRow.rows[0]?.handover_otp_id).toBe(assignmentRow.rows[0]?.handover_otp_id) // копия НЕ разошлась с заказом
    expect(orderRow.rows[0]?.handover_otp_id).not.toBe(oldOtpId)

    await expect(deliver.execute({ assignmentId, userId: courierUserId, otpCode: OTP_CODE })).rejects.toBeInstanceOf(OtpMismatchError)
    await deliver.execute({ assignmentId, userId: courierUserId, otpCode: result.code })
    const delivered = await pool.query<{ status: string }>('SELECT status FROM delivery_assignments WHERE id = $1', [assignmentId])
    expect(delivered.rows[0]?.status).toBe('delivered')

    await pool.query('DELETE FROM audit_log WHERE actor_user_id = $1', [supportAgentUserId]).catch(() => undefined)
    await pool.query('DELETE FROM users WHERE id = $1', [supportAgentUserId]).catch(() => undefined)
    await cleanup({ assignmentId, orderId, otpIds: [oldOtpId, assignmentRow.rows[0]?.handover_otp_id ?? ''], courierId, courierUserId, customerId, pharmacyId, tenantId })
  })

  it('POST record-cash БЕЗ Idempotency-Key -> 400 IDEMPOTENCY_KEY_REQUIRED, use case не вызывается', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedUser(tenantId, 'customer')
    const { courierId, userId: courierUserId } = await seedCourier(tenantId)
    await seedShift(courierId)
    const orderId = await seedOrder(tenantId, pharmacyId, customerId)
    const otpId = await seedHandoverOtp(tenantId, orderId, OTP_CODE)
    const assignmentId = await seedAssignment(orderId, courierId)
    await pool.query(`UPDATE delivery_assignments SET status = 'en_route_to_customer', handover_otp_id = $2 WHERE id = $1`, [assignmentId, otpId])
    const token = jwtSigner.sign({ sub: courierUserId, role: 'courier', tenantId, pharmacyId: null, chainId: null, sessionId: randomUUID() })

    const response = await request(testApp.httpServer)
      .post(`/api/v1/delivery-assignments/${assignmentId}/record-cash`)
      .set('Authorization', `Bearer ${token}`)
      .send({ collectedDiram: 6000, changeDiram: 0 })

    expect(response.status).toBe(400)
    expect((response.body as { error: { code: string } }).error.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REQUIRED)
    const courierRow = await pool.query<{ current_cash_on_hand_diram: string }>(
      'SELECT current_cash_on_hand_diram FROM couriers WHERE id = $1',
      [courierId],
    )
    expect(courierRow.rows[0]?.current_cash_on_hand_diram).toBe('0') // use case не выполнился

    await cleanup({ assignmentId, orderId, otpIds: [otpId], courierId, courierUserId, customerId, pharmacyId, tenantId })
  })
})
