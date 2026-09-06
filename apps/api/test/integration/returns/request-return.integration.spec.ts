/**
 * `RequestReturnUseCase` — integration (EP-11, DTJ-273, тест-план тикета) — РЕАЛЬНЫЙ Postgres
 * для `returns`-собственных портов (repository/orders-facade/unit-of-work/outbox), фейки для
 * межмодульных фасадов (`ReturnsDeliveryPort`/`ReturnsSupportFacadePort`/`ReturnsTenantSettingsPort`
 * — см. JSDoc `returns-test.fixture.ts`).
 *
 * Покрывает:
 *  - AC1/TC-RET-001 — курьерская ветка (`picked_up` + `refused_at_door`) → `return_in_transit` сразу.
 *  - AC2/TC-RET-006 — окно спора истекло → `422`-класс `ReturnWindowExpiredError`, строка не создана.
 *  - AC3 — `undelivered` → `SupportFacade`, `order_returns` НЕ создан.
 *  - Дубликат активного возврата → `DuplicateActiveReturnError`.
 *  - Пост-доставочная ветка → `return_requested` + best-effort `assignReturnCourier`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pino from 'pino'
import { DuplicateActiveReturnError, ReturnWindowExpiredError } from '@dorutj/contracts'
import { orderReturns } from '@/db/schema/returns.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { RequestReturnUseCase, type RequestReturnCommand } from '@/modules/returns/application/use-cases/request-return.use-case.js'
import { DrizzleReturnsRepository } from '@/modules/returns/infrastructure/repositories/drizzle-returns.repository.js'
import { DrizzleReturnsOrdersFacadeAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-orders-facade.adapter.js'
import { DrizzleReturnsUnitOfWorkAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-unit-of-work.adapter.js'
import { DrizzleReturnsOutboxAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-outbox.adapter.js'
import { UuidV7IdGeneratorAdapter } from '@/shared-kernel/infrastructure/adapters/uuidv7-id-generator.adapter.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import {
  FakeReturnsDeliveryPort,
  FakeReturnsSupportFacadePort,
  FakeReturnsTenantSettingsPort,
  cleanupTenant,
  connect,
  isPostgresReachable,
  seedCourier,
  seedOrder,
  seedTenant,
  seedUser,
  TEST_DATABASE_URL,
} from './returns-test.fixture.js'

const HOUR_MS = 3_600_000
const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

describe.skipIf(!postgresAvailable)('RequestReturnUseCase — integration (DTJ-273)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repository: DrizzleReturnsRepository
  let ordersFacade: DrizzleReturnsOrdersFacadeAdapter
  let unitOfWork: DrizzleReturnsUnitOfWorkAdapter
  let outboxPort: DrizzleReturnsOutboxAdapter
  let deliveryPort: FakeReturnsDeliveryPort
  let supportFacade: FakeReturnsSupportFacadePort
  let tenantSettings: FakeReturnsTenantSettingsPort
  let ids: UuidV7IdGeneratorAdapter
  let fixedNow: Date
  let clock: Clock
  let useCase: RequestReturnUseCase

  let tenantId: string
  let customerId: string

  beforeAll(() => {
    ;({ pool, db } = connect())
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    if (tenantId === undefined) return
    await cleanupTenant(db, tenantId)
  })

  async function setup(): Promise<void> {
    tenantId = await seedTenant(db)
    customerId = await seedUser(db, tenantId, 'customer')
    repository = new DrizzleReturnsRepository(db)
    ordersFacade = new DrizzleReturnsOrdersFacadeAdapter(db)
    unitOfWork = new DrizzleReturnsUnitOfWorkAdapter(db)
    outboxPort = new DrizzleReturnsOutboxAdapter(db)
    deliveryPort = new FakeReturnsDeliveryPort()
    supportFacade = new FakeReturnsSupportFacadePort()
    tenantSettings = new FakeReturnsTenantSettingsPort()
    ids = new UuidV7IdGeneratorAdapter()
    fixedNow = new Date('2026-09-06T12:00:00.000Z')
    clock = { now: () => fixedNow }
    useCase = new RequestReturnUseCase(
      repository,
      ordersFacade,
      deliveryPort,
      supportFacade,
      tenantSettings,
      unitOfWork,
      outboxPort,
      ids,
      clock,
      pino({ enabled: false }),
    )
  }

  function buildCommand(overrides: Partial<RequestReturnCommand> & { readonly orderId: string }): RequestReturnCommand {
    return {
      tenantId,
      initiatorId: customerId,
      initiatorRole: 'customer',
      reason: 'defect',
      ...overrides,
    }
  }

  it('AC1/TC-RET-001 — picked_up + refused_at_door → return_in_transit сразу, courierReturnFeeDiram > 0', async () => {
    await setup()
    const courierId = await seedCourier(db, tenantId)
    const orderId = await seedOrder(db, { tenantId, customerId, status: 'picked_up', courierId })

    const result = await useCase.execute(buildCommand({ orderId, reason: 'refused_at_door' }))

    expect(result.kind).toBe('return_created')
    const returnId = result.kind === 'return_created' ? result.returnId : ''
    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_in_transit')
    expect(row?.courierId).toBe(courierId)
    expect(Number(row?.courierReturnFeeDiram)).toBeGreaterThan(0)
    expect(deliveryPort.calculateReturnFeeCalls).toHaveLength(1)

    const [outboxRow] = await db.select().from(outbox).where(eq(outbox.aggregateId, returnId))
    expect(outboxRow?.eventType).toBe('ReturnRequestedEvent')
    expect((outboxRow?.payload as { status?: string } | undefined)?.status).toBe('return_in_transit')
  })

  it('пост-доставочная ветка — delivered + defect → return_requested, best-effort assignReturnCourier вызван', async () => {
    await setup()
    const orderId = await seedOrder(db, { tenantId, customerId, status: 'delivered', deliveredAt: fixedNow })

    const result = await useCase.execute(buildCommand({ orderId, reason: 'defect' }))

    expect(result.kind).toBe('return_created')
    const returnId = result.kind === 'return_created' ? result.returnId : ''
    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_requested')
    expect(row?.courierId).toBeNull()

    // fire-and-forget (после commit, не await-нут внутри execute()) — даём микротаскам стечь.
    await new Promise((resolve) => setImmediate(resolve))
    expect(deliveryPort.assignReturnCourierCalls).toEqual([{ tenantId, returnId }])
  })

  it('AC2/TC-RET-006 — окно спора истекло → ReturnWindowExpiredError, order_returns НЕ создан', async () => {
    await setup()
    tenantSettings.setDisputeWindowHours(24)
    const deliveredAt = new Date(fixedNow.getTime() - 30 * HOUR_MS)
    const orderId = await seedOrder(db, { tenantId, customerId, status: 'delivered', deliveredAt })

    await expect(useCase.execute(buildCommand({ orderId, reason: 'customer_dispute_post_delivery' }))).rejects.toBeInstanceOf(
      ReturnWindowExpiredError,
    )

    const rows = await db.select().from(orderReturns).where(eq(orderReturns.orderId, orderId))
    expect(rows).toHaveLength(0)
  })

  it('окно спора НЕ истекло (1ч < 24ч) — возврат создаётся', async () => {
    await setup()
    tenantSettings.setDisputeWindowHours(24)
    const deliveredAt = new Date(fixedNow.getTime() - 1 * HOUR_MS)
    const orderId = await seedOrder(db, { tenantId, customerId, status: 'delivered', deliveredAt })

    const result = await useCase.execute(buildCommand({ orderId, reason: 'customer_dispute_post_delivery' }))
    expect(result.kind).toBe('return_created')
  })

  it('AC3 — reason=undelivered → SupportFacade.createAutoOrManualTicket, order_returns НЕ создан', async () => {
    await setup()
    const orderId = await seedOrder(db, { tenantId, customerId, status: 'delivered', deliveredAt: fixedNow })

    const result = await useCase.execute(buildCommand({ orderId, reason: 'undelivered' }))

    expect(result).toEqual({ kind: 'support_ticket_created', ticketId: supportFacade.ticketId })
    expect(supportFacade.calls).toHaveLength(1)
    expect(supportFacade.calls[0]).toMatchObject({ tenantId, orderId, category: 'order_not_received', createdBy: customerId })

    const rows = await db.select().from(orderReturns).where(eq(orderReturns.orderId, orderId))
    expect(rows).toHaveLength(0)
  })

  it('дубликат активного возврата — DuplicateActiveReturnError, вторая строка НЕ создана', async () => {
    await setup()
    const orderId = await seedOrder(db, { tenantId, customerId, status: 'delivered', deliveredAt: fixedNow })
    const first = await useCase.execute(buildCommand({ orderId, reason: 'defect' }))
    expect(first.kind).toBe('return_created')

    await expect(useCase.execute(buildCommand({ orderId, reason: 'wrong_item' }))).rejects.toBeInstanceOf(DuplicateActiveReturnError)

    const rows = await db.select().from(orderReturns).where(eq(orderReturns.orderId, orderId))
    expect(rows).toHaveLength(1)
  })
})
