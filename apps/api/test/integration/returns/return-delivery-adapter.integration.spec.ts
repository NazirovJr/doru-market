/**
 * Возврат от запроса до `return_in_transit` через РЕАЛЬНЫЙ `AppModule` (DI-граф целиком) и реальную БД:
 * тариф обратного рейса считает `DeliveryFacade`, подбор курьера идёт через пул кандидатов delivery.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { TestingModule } from '@nestjs/testing'
import { orderReturns } from '@/db/schema/returns.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { RequestReturnUseCase } from '@/modules/returns/application/use-cases/request-return.use-case.js'
import { MarkReturnInTransitUseCase } from '@/modules/returns/application/use-cases/mark-return-in-transit.use-case.js'
import { RETURNS_DELIVERY_PORT, type ReturnsCourierAssignment, type ReturnsDeliveryPort } from '@/modules/returns/application/ports/delivery-facade.port.js'
import { bootAppModule } from '../common/__tests__/app-module-boot.js'
import {
  canonicalOrderNumber,
  cleanupPharmacy,
  cleanupTenant,
  connect,
  isPostgresReachable,
  seedCourier,
  seedOrder,
  seedPharmacy,
  seedTenant,
  seedUser,
  TEST_DATABASE_URL,
} from './returns-test.fixture.js'

const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

const PHARMACY_LAT = 38.5598
const PHARMACY_LON = 68.787
const CUSTOMER_LAT = 38.5688 // ~1 км севернее аптеки
const BASE_RATE_DIRAM = 1_500
const RATE_PER_KM_DIRAM = 300

describe.skipIf(!postgresAvailable)('Возврат: RETURNS_DELIVERY_PORT поверх DeliveryFacade — integration', () => {
  let pool: Pool
  let db: NodePgDatabase
  let app: TestingModule
  let requestReturn: RequestReturnUseCase
  let markInTransit: MarkReturnInTransitUseCase
  let deliveryPort: ReturnsDeliveryPort

  let tenantId: string
  let pharmacyId: string
  let customerId: string
  let courierId: string
  let zoneId: string

  beforeAll(async () => {
    ;({ pool, db } = connect())
    app = await bootAppModule()
    requestReturn = app.get(RequestReturnUseCase, { strict: false })
    markInTransit = app.get(MarkReturnInTransitUseCase, { strict: false })
    deliveryPort = app.get<ReturnsDeliveryPort>(RETURNS_DELIVERY_PORT, { strict: false })
  }, 60_000)

  afterAll(async () => {
    await app.close()
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await pool.query('DELETE FROM delivery_pricing_rules WHERE tenant_id = $1', [tenantId])
    await pool.query('DELETE FROM delivery_zones WHERE tenant_id = $1', [tenantId])
    await cleanupTenant(db, tenantId)
    await cleanupPharmacy(db, pharmacyId)
  })

  async function seedDeliveryEnvironment(freeDeliveryThresholdDiram: number | null): Promise<void> {
    const zone = await pool.query<{ id: string }>(
      `INSERT INTO delivery_zones (tenant_id, name, center_latitude, center_longitude, radius_km, priority, is_active)
       VALUES ($1, 'DTJ-446 zone', $2, $3, 20, 0, true) RETURNING id`,
      [tenantId, PHARMACY_LAT, PHARMACY_LON],
    )
    zoneId = zone.rows[0]?.id ?? ''
    await pool.query(
      `INSERT INTO delivery_pricing_rules
         (tenant_id, zone_id, base_rate_diram, rate_per_km_diram, min_order_amount_diram, free_delivery_threshold_diram, effective_from)
       VALUES ($1, $2, $3, $4, 0, $5, '2026-01-01')`,
      [tenantId, zoneId, BASE_RATE_DIRAM, RATE_PER_KM_DIRAM, freeDeliveryThresholdDiram],
    )
  }

  async function seedScenario(orderStatus: 'delivered' | 'picked_up'): Promise<string> {
    tenantId = await seedTenant(db)
    customerId = await seedUser(db, tenantId, 'customer')
    pharmacyId = await seedPharmacy(db)
    courierId = await seedCourier(db, tenantId)
    await pool.query(
      `UPDATE couriers SET status = 'active', shift_status = 'on_shift', last_known_latitude = $2,
         last_known_longitude = $3, last_location_at = NOW() WHERE id = $1`,
      [courierId, PHARMACY_LAT, PHARMACY_LON],
    )
    // Порог бесплатной доставки ниже суммы заказа (50 сомони): обычная доставка стоила бы 0, обратный рейс — нет.
    await seedDeliveryEnvironment(1_000)
    const orderId =
      orderStatus === 'delivered'
        ? await seedOrder(db, { tenantId, customerId, pharmacyId, status: 'delivered', deliveredAt: new Date(), orderNumber: canonicalOrderNumber() })
        : await seedOrder(db, { tenantId, customerId, pharmacyId, status: 'picked_up', courierId, orderNumber: canonicalOrderNumber() })
    await pool.query('UPDATE orders SET delivery_latitude = $2, delivery_longitude = $3 WHERE id = $1', [orderId, CUSTOMER_LAT, PHARMACY_LON])
    return orderId
  }

  function expectFeeInDistanceRange(fee: bigint): void {
    expect(fee).toBeGreaterThan(BigInt(BASE_RATE_DIRAM))
    expect(fee).toBeLessThan(BigInt(BASE_RATE_DIRAM + 2 * RATE_PER_KM_DIRAM))
  }

  it('доставленный заказ: запрос возврата -> курьер подобран -> in_transit с тарифом рейса', async () => {
    const orderId = await seedScenario('delivered')
    const assignSpy = vi.spyOn(deliveryPort, 'assignReturnCourier')

    const created = await requestReturn.execute({
      tenantId,
      orderId,
      reason: 'defect',
      initiatorId: customerId,
      initiatorRole: 'customer',
    })
    expect(created.kind).toBe('return_created')
    if (created.kind !== 'return_created') return

    const assignment = (await assignSpy.mock.results[0]?.value) as ReturnsCourierAssignment | null
    expect(assignment?.courierId).toBe(courierId)
    assignSpy.mockRestore()

    await markInTransit.execute({ tenantId, returnId: created.returnId, orderId, courierId })

    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, created.returnId))
    expect(row?.status).toBe('return_in_transit')
    expect(row?.courierId).toBe(courierId)
    expectFeeInDistanceRange(row?.courierReturnFeeDiram ?? 0n)
    const events = await db.select().from(outbox).where(eq(outbox.tenantId, tenantId))
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(['ReturnRequestedEvent', 'ReturnInTransitEvent']))
  })

  it('курьерская ветка (picked_up + refused_at_door): возврат сразу in_transit, тариф посчитан', async () => {
    const orderId = await seedScenario('picked_up')

    const created = await requestReturn.execute({
      tenantId,
      orderId,
      reason: 'refused_at_door',
      initiatorId: customerId,
      initiatorRole: 'customer',
    })

    expect(created.kind).toBe('return_created')
    if (created.kind !== 'return_created') return
    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, created.returnId))
    expect(row?.status).toBe('return_in_transit')
    expectFeeInDistanceRange(row?.courierReturnFeeDiram ?? 0n)
  })

  it('нет свободных курьеров рядом -> подбор возвращает null и не бросает', async () => {
    const orderId = await seedScenario('delivered')
    await pool.query(`UPDATE couriers SET shift_status = 'off_shift' WHERE id = $1`, [courierId])
    const created = await requestReturn.execute({ tenantId, orderId, reason: 'defect', initiatorId: customerId, initiatorRole: 'customer' })
    if (created.kind !== 'return_created') throw new Error('expected return_created')

    expect(await deliveryPort.assignReturnCourier(tenantId, created.returnId)).toBeNull()
  })

  it('чужой тенант: расчёт тарифа не раскрывает заказ', async () => {
    const orderId = await seedScenario('delivered')

    await expect(deliveryPort.calculateReturnFee(randomUUID(), orderId)).rejects.toThrow()
  })
})
