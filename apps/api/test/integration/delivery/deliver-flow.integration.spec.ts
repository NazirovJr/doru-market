// Полный проход assigned -> ... -> delivered. DeliveryOrdersPort/DeliveryOutboxPort — фейки;
// реальны только delivery_assignments/couriers/courier_shifts/courier_earnings + auth otp_codes.
import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CashAmountMismatchError, OtpMismatchError } from '@dorutj/contracts'
import { DrizzleDeliveryAssignmentRepository } from '@/modules/delivery/infrastructure/repositories/delivery-assignment.repository.js'
import { DrizzleCourierRepository } from '@/modules/delivery/infrastructure/repositories/courier.repository.js'
import { DrizzleCourierShiftRepository } from '@/modules/delivery/infrastructure/repositories/courier-shift.repository.js'
import { DrizzleCourierEarningsRepository } from '@/modules/delivery/infrastructure/repositories/courier-earnings.repository.js'
import { DepartUseCase } from '@/modules/delivery/application/use-cases/depart.use-case.js'
import { DepartToCustomerUseCase } from '@/modules/delivery/application/use-cases/depart-to-customer.use-case.js'
import { RecordCashUseCase } from '@/modules/delivery/application/use-cases/record-cash.use-case.js'
import { DeliverUseCase } from '@/modules/delivery/application/use-cases/deliver.use-case.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '@/modules/delivery/application/ports/delivery-orders.port.js'
import type { DeliveryOutboxPort } from '@/modules/delivery/application/ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort, DeliveryUnitOfWorkCallback } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import type { CourierDepartSlaWatchdogQueuePort } from '@/modules/delivery/application/ports/courier-depart-sla-watchdog-queue.port.js'
import { DrizzleOtpCodesRepository } from '@/modules/auth/infrastructure/repositories/drizzle-otp-codes.repository.js'
import { DrizzleUnitOfWorkAdapter } from '@/modules/auth/infrastructure/adapters/drizzle-unit-of-work.adapter.js'
import type { RateLimitCheckerPort } from '@/modules/auth/application/ports/rate-limit-checker.port.js'

const TEST_DATABASE_URL =
  process.env.DELIVERY_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PROBE_TIMEOUT_MS = 1_500
const SHA256_HEX_LENGTH = 64
const OTP_CODE = '4821'

function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex').slice(0, SHA256_HEX_LENGTH)
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

describe.skipIf(!postgresAvailable)('depart -> depart-to-customer -> record-cash -> deliver (DTJ-317)', () => {
  let pool: Pool
  let db: NodePgDatabase

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
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

  async function seedShift(courierId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO courier_shifts (id, courier_id, status, opening_cash_on_hand_diram, cash_collected_diram)
       VALUES ($1, $2, 'active', 0, 0)`,
      [id, courierId],
    )
    return id
  }

  async function seedOrder(tenantId: string, pharmacyId: string, customerId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'picked_up', 'cash_courier', 55, 5, 60, 'Dushanbe, Rudaki 1', $5, $6)`,
      [id, `260925-${id.slice(0, 5)}`, customerId, pharmacyId, tenantId, randomUUID()],
    )
    return id
  }

  async function seedHandoverOtp(tenantId: string, orderId: string, code: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO otp_codes (id, tenant_id, subject_ref, purpose, code_hash, plain_code, expires_at)
       VALUES ($1, $2, $3, 'delivery_handover', $4, $5, NOW() + interval '900 seconds')`,
      [id, tenantId, orderId, hashOtpCode(code, id), code],
    )
    return id
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

  function makeOrderContext(input: {
    readonly orderId: string
    readonly tenantId: string
    readonly pharmacyId: string
    readonly customerId: string
    readonly handoverOtpId: string
  }): DeliveryOrderContext {
    return {
      ...input,
      medicineIds: [],
      itemsCount: 1,
      paymentMethod: 'cash_courier',
      deliveryGeoPoint: null,
      deliveryFeeDiram: 500n,
      totalAmountDiram: 6000n,
      deliveryAddress: 'Dushanbe, Rudaki 1',
      deliveryLandmark: null,
    }
  }

  it('assigned -> en_route_to_pharmacy -> picked_up_from_pharmacy -> en_route_to_customer -> delivered (TC-DELIV-009..013)', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedUser(tenantId, 'customer')
    const { courierId, userId: courierUserId } = await seedCourier(tenantId)
    await seedShift(courierId)
    const orderId = await seedOrder(tenantId, pharmacyId, customerId)
    const otpId = await seedHandoverOtp(tenantId, orderId, OTP_CODE)
    const assignmentId = await seedAssignment(orderId, courierId)

    const assignments = new DrizzleDeliveryAssignmentRepository(db)
    const couriers = new DrizzleCourierRepository(db)
    const shifts = new DrizzleCourierShiftRepository(db)
    const earnings = new DrizzleCourierEarningsRepository(db)
    const orderContext = makeOrderContext({ orderId, tenantId, pharmacyId, customerId, handoverOtpId: otpId })
    const orders: DeliveryOrdersPort = {
      getOrderForRating: () => Promise.resolve(null),
      getDeliveryContext: () => Promise.resolve(orderContext),
      markOrderDelivered: () => Promise.resolve(),
    }
    const outboxAppend: DeliveryOutboxPort['append'] = () => Promise.resolve()
    const outbox: DeliveryOutboxPort = { append: outboxAppend }
    const deliveryUow: DeliveryUnitOfWorkPort = { run: <T>(cb: DeliveryUnitOfWorkCallback<T>) => db.transaction((tx: unknown) => cb(tx)) }
    const watchdog: CourierDepartSlaWatchdogQueuePort = { schedule: () => Promise.resolve(), cancel: () => Promise.resolve() }
    const clock = { now: () => new Date() }

    const depart = new DepartUseCase(couriers, assignments, deliveryUow, watchdog)
    await depart.execute({ assignmentId, userId: courierUserId })
    expect((await assignments.findById(assignmentId))?.status).toBe('en_route_to_pharmacy')

    const departToCustomer = new DepartToCustomerUseCase(couriers, assignments, orders, deliveryUow, clock)
    await departToCustomer.execute({ assignmentId, userId: courierUserId })
    const afterDeparted = await assignments.findById(assignmentId)
    expect(afterDeparted?.status).toBe('en_route_to_customer')
    expect(afterDeparted?.handoverOtpId).toBe(otpId)

    const recordCash = new RecordCashUseCase(couriers, assignments, shifts, orders, deliveryUow)
    await expect(recordCash.execute({ assignmentId, userId: courierUserId, collectedDiram: 6000, changeDiram: 500 })).rejects.toBeInstanceOf(
      CashAmountMismatchError,
    )
    await recordCash.execute({ assignmentId, userId: courierUserId, collectedDiram: 6000, changeDiram: 0 })
    const courierAfterCash = await couriers.findById(courierId)
    expect(courierAfterCash?.currentCashOnHandDiram.diram).toBe(6000n)

    const otpCodesRepository = new DrizzleOtpCodesRepository(db)
    const authUow = new DrizzleUnitOfWorkAdapter(db)
    const rateLimit: RateLimitCheckerPort = { incrementAndGet: () => Promise.resolve({ count: 1, ttlSeconds: 900 }) }
    const ids = { next: () => randomUUID() }
    const deliver = new DeliverUseCase(couriers, assignments, orders, outbox, earnings, deliveryUow, otpCodesRepository, rateLimit, authUow, clock, ids)

    await deliver.execute({ assignmentId, userId: courierUserId, otpCode: OTP_CODE })
    const delivered = await assignments.findById(assignmentId)
    expect(delivered?.status).toBe('delivered')
    const earningsRows = await pool.query<{ readonly amount_diram: string }>(
      'SELECT amount_diram FROM courier_earnings WHERE delivery_assignment_id = $1',
      [assignmentId],
    )
    expect(earningsRows.rows).toHaveLength(1)
    expect(BigInt(earningsRows.rows[0]?.amount_diram ?? '0')).toBe(500n)

    await expect(deliver.execute({ assignmentId, userId: courierUserId, otpCode: OTP_CODE })).rejects.toBeInstanceOf(OtpMismatchError)

    await pool.query('DELETE FROM courier_earnings WHERE delivery_assignment_id = $1', [assignmentId])
    await pool.query('DELETE FROM delivery_assignments WHERE id = $1', [assignmentId])
    await pool.query('DELETE FROM courier_shifts WHERE courier_id = $1', [courierId])
    await pool.query('DELETE FROM otp_codes WHERE id = $1', [otpId])
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    await pool.query('DELETE FROM couriers WHERE id = $1', [courierId])
    await pool.query('DELETE FROM users WHERE id = $1', [courierUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
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

    const assignments = new DrizzleDeliveryAssignmentRepository(db)
    const couriers = new DrizzleCourierRepository(db)
    const earnings = new DrizzleCourierEarningsRepository(db)
    const orderContext = makeOrderContext({ orderId, tenantId, pharmacyId, customerId, handoverOtpId: otpId })
    const orders: DeliveryOrdersPort = {
      getOrderForRating: () => Promise.resolve(null),
      getDeliveryContext: () => Promise.resolve(orderContext),
      markOrderDelivered: () => Promise.resolve(),
    }
    const outbox: DeliveryOutboxPort = { append: () => Promise.resolve() }
    const deliveryUow: DeliveryUnitOfWorkPort = { run: <T>(cb: DeliveryUnitOfWorkCallback<T>) => db.transaction((tx: unknown) => cb(tx)) }
    const otpCodesRepository = new DrizzleOtpCodesRepository(db)
    const authUow = new DrizzleUnitOfWorkAdapter(db)
    const rateLimit: RateLimitCheckerPort = { incrementAndGet: () => Promise.resolve({ count: 1, ttlSeconds: 900 }) }
    const clock = { now: () => new Date() }
    const ids = { next: () => randomUUID() }
    const deliver = new DeliverUseCase(couriers, assignments, orders, outbox, earnings, deliveryUow, otpCodesRepository, rateLimit, authUow, clock, ids)

    await expect(deliver.execute({ assignmentId, userId: courierUserId, otpCode: OTP_CODE })).rejects.toBeInstanceOf(CashAmountMismatchError)

    await pool.query('DELETE FROM delivery_assignments WHERE id = $1', [assignmentId])
    await pool.query('DELETE FROM courier_shifts WHERE courier_id = $1', [courierId])
    await pool.query('DELETE FROM otp_codes WHERE id = $1', [otpId])
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId])
    await pool.query('DELETE FROM couriers WHERE id = $1', [courierId])
    await pool.query('DELETE FROM users WHERE id = $1', [courierUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [customerId])
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [pharmacyId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
  })
})
