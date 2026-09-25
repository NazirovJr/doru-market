// TC-DELIV-006/072 на реальном Postgres: конкурентный claim сериализуется условным UPDATE (claimUnassigned), не SELECT FOR UPDATE.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AssignmentAlreadyClaimedError } from '@dorutj/contracts'
import { GeoPoint } from '@/shared-kernel/domain/value-objects/geo-point.vo.js'
import { DeliveryAssignment } from '@/modules/delivery/domain/delivery-assignment.entity.js'
import { DrizzleDeliveryAssignmentRepository } from '@/modules/delivery/infrastructure/repositories/delivery-assignment.repository.js'
import { DrizzleCourierRepository } from '@/modules/delivery/infrastructure/repositories/courier.repository.js'
import { ClaimDeliveryAssignmentUseCase } from '@/modules/delivery/application/use-cases/claim-delivery-assignment.use-case.js'
import type { DeliveryOrdersPort, DeliveryOrderContext } from '@/modules/delivery/application/ports/delivery-orders.port.js'
import type { PharmacyLookupPort, PharmacyLocation } from '@/modules/delivery/application/ports/pharmacy-lookup.port.js'
import type { DeliveryOutboxPort } from '@/modules/delivery/application/ports/delivery-outbox.port.js'
import type { DeliveryUnitOfWorkPort, DeliveryUnitOfWorkCallback } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import type { CourierDepartSlaWatchdogQueuePort } from '@/modules/delivery/application/ports/courier-depart-sla-watchdog-queue.port.js'

const TEST_DATABASE_URL =
  process.env.DELIVERY_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

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

describe.skipIf(!postgresAvailable)('ClaimDeliveryAssignmentUseCase — TC-DELIV-006/072 concurrency (DTJ-316)', () => {
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
    await pool.query(`INSERT INTO tenants (id, slug, is_neutral) VALUES ($1, $2, false)`, [id, `dtj316-${id.slice(0, 8)}`])
    return id
  }

  async function seedPharmacy(): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO pharmacies (id, name, address_text, latitude, longitude, phone)
       VALUES ($1, 'Test Pharmacy DTJ-316', 'Dushanbe, test str. 1', 38.5598, 68.7870, '+992900000004')`,
      [id],
    )
    return id
  }

  async function seedOrder(tenantId: string, pharmacyId: string, customerId: string): Promise<string> {
    const id = randomUUID()
    await pool.query(
      `INSERT INTO orders
         (id, order_number, customer_id, pharmacy_id, status, payment_method,
          items_total_tjs, delivery_fee_tjs, total_amount_tjs, delivery_address, tenant_id, checkout_attempt_id)
       VALUES ($1, $2, $3, $4, 'picked_up', 'cash_courier', 100, 50, 150, 'Dushanbe, Rudaki 1', $5, $6)`,
      [id, `260925-${id.slice(0, 5)}`, customerId, pharmacyId, tenantId, randomUUID()],
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

  async function cleanup(ids: {
    assignmentId: string
    orderId: string
    courierIds: readonly string[]
    courierUserIds: readonly string[]
    customerId: string
    pharmacyId: string
    tenantId: string
  }): Promise<void> {
    await pool.query('DELETE FROM delivery_assignments WHERE id = $1', [ids.assignmentId]).catch(() => undefined)
    await pool.query('DELETE FROM orders WHERE id = $1', [ids.orderId]).catch(() => undefined)
    for (const courierId of ids.courierIds) {
      await pool.query('DELETE FROM couriers WHERE id = $1', [courierId]).catch(() => undefined)
    }
    for (const userId of ids.courierUserIds) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined)
    }
    await pool.query('DELETE FROM users WHERE id = $1', [ids.customerId]).catch(() => undefined)
    await pool.query('DELETE FROM pharmacies WHERE id = $1', [ids.pharmacyId]).catch(() => undefined)
    await pool.query('DELETE FROM tenants WHERE id = $1', [ids.tenantId]).catch(() => undefined)
  }

  function makeUseCase(): ClaimDeliveryAssignmentUseCase {
    const assignments = new DrizzleDeliveryAssignmentRepository(db)
    const couriers = new DrizzleCourierRepository(db)
    const geo = GeoPoint.create(38.5598, 68.787)
    if (!geo.ok) throw new Error('fixture error')
    const pharmacyLocation: PharmacyLocation = { id: 'pharmacy', name: 'P', addressText: 'A', geoPoint: geo.value, chainId: null }
    const orderContext: DeliveryOrderContext = {
      orderId: 'irrelevant',
      tenantId: 'irrelevant',
      pharmacyId: 'pharmacy',
      medicineIds: [],
      itemsCount: 1,
      paymentMethod: 'cash_courier',
      deliveryGeoPoint: null,
      deliveryFeeDiram: 1000n,
    }
    const orders: DeliveryOrdersPort = { getOrderForRating: () => Promise.resolve(null), getDeliveryContext: () => Promise.resolve(orderContext) }
    const pharmacies: PharmacyLookupPort = { findById: () => Promise.resolve(pharmacyLocation) }
    const outbox: DeliveryOutboxPort = { append: () => Promise.resolve() }
    const uow: DeliveryUnitOfWorkPort = { run: <T>(cb: DeliveryUnitOfWorkCallback<T>) => db.transaction((tx: unknown) => cb(tx)) }
    const watchdog: CourierDepartSlaWatchdogQueuePort = { schedule: () => Promise.resolve(), cancel: () => Promise.resolve() }
    const clock = { now: () => new Date() }
    return new ClaimDeliveryAssignmentUseCase(couriers, assignments, orders, pharmacies, outbox, uow, watchdog, clock)
  }

  it('TC-DELIV-006/072: два курьера одновременно claim ОДНОГО назначения из пула — ровно один успешен, второй 409 AssignmentAlreadyClaimedError', async () => {
    const tenantId = await seedTenant()
    const pharmacyId = await seedPharmacy()
    const customerId = await seedUser(tenantId, 'customer')
    const orderId = await seedOrder(tenantId, pharmacyId, customerId)
    const courierA = await seedCourier(tenantId)
    const courierB = await seedCourier(tenantId)

    const now = new Date()
    const assignmentResult = DeliveryAssignment.create({
      id: randomUUID(),
      orderId,
      landmarkText: null,
      requiresColdChain: false,
      hasActiveNonTerminalAssignment: false,
      now,
    })
    if (!assignmentResult.ok) throw new Error('fixture: DeliveryAssignment.create failed')
    const assignment = assignmentResult.value
    await new DrizzleDeliveryAssignmentRepository(db).save(assignment)

    try {
      const [resultA, resultB] = await Promise.allSettled([
        makeUseCase().execute({ assignmentId: assignment.id, userId: courierA.userId }),
        makeUseCase().execute({ assignmentId: assignment.id, userId: courierB.userId }),
      ])

      const fulfilled = [resultA, resultB].filter((r) => r.status === 'fulfilled')
      const rejected = [resultA, resultB].filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      const rejection = rejected[0]
      if (rejection?.status !== 'rejected') throw new Error('fixture: expected a rejection')
      expect(rejection.reason).toBeInstanceOf(AssignmentAlreadyClaimedError)

      const reloaded = await new DrizzleDeliveryAssignmentRepository(db).findById(assignment.id)
      expect(reloaded?.status).toBe('assigned')
      expect([courierA.courierId, courierB.courierId]).toContain(reloaded?.courierId)
    } finally {
      await cleanup({
        assignmentId: assignment.id,
        orderId,
        courierIds: [courierA.courierId, courierB.courierId],
        courierUserIds: [courierA.userId, courierB.userId],
        customerId,
        pharmacyId,
        tenantId,
      })
    }
  })
})
