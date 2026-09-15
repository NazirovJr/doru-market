/**
 * `MarkReturnInTransitUseCase` / `RejectReturnUseCase` / `AdminOverrideReturnUseCase` /
 * `RetryReturnTransitUseCase` — integration (EP-11, DTJ-273, тест-план тикета). Каждый тест
 * заводит возврат НАПРЯМУЮ через домен + `DrizzleReturnsRepository.save()` (минуя
 * `RequestReturnUseCase` — его собственное поведение уже покрыто
 * `request-return.integration.spec.ts`), чтобы стартовать сразу с нужного статуса.
 *
 * Покрывает:
 *  - `MarkReturnInTransitUseCase`: `return_requested → return_in_transit`, fee всегда > 0.
 *  - `RejectReturnUseCase`: `return_in_transit → return_rejected`.
 *  - `AdminOverrideReturnUseCase`: `return_rejected → return_confirmed`, RBAC (`super_admin` любая
 *    сеть / `pharmacy_admin` СВОЕЙ сети — успех, чужой сети — `ForbiddenError`).
 *  - `RetryReturnTransitUseCase`: `return_rejected → return_in_transit`, `resolvedAt` сброшен.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { ForbiddenError } from '@dorutj/contracts'
import { isErr } from '@dorutj/domain-kernel'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { orderReturns } from '@/db/schema/returns.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { OrderReturn, ReturnReason } from '@/modules/returns/domain/index.js'
import { MarkReturnInTransitUseCase } from '@/modules/returns/application/use-cases/mark-return-in-transit.use-case.js'
import { RejectReturnUseCase } from '@/modules/returns/application/use-cases/reject-return.use-case.js'
import { AdminOverrideReturnUseCase } from '@/modules/returns/application/use-cases/admin-override-return.use-case.js'
import { RetryReturnTransitUseCase } from '@/modules/returns/application/use-cases/retry-return-transit.use-case.js'
import type { ReturnsPolicyActor } from '@/modules/returns/returns-policy.guard.js'
import { DrizzleReturnsRepository } from '@/modules/returns/infrastructure/repositories/drizzle-returns.repository.js'
import { DrizzleReturnsOrdersFacadeAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-orders-facade.adapter.js'
import { DrizzleReturnsUnitOfWorkAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-unit-of-work.adapter.js'
import { DrizzleReturnsOutboxAdapter } from '@/modules/returns/infrastructure/adapters/drizzle-returns-outbox.adapter.js'
import {
  FakeReturnsDeliveryPort,
  cleanupPharmacy,
  cleanupTenant,
  connect,
  isPostgresReachable,
  seedChain,
  seedOrder,
  seedPharmacy,
  seedTenant,
  seedUser,
  TEST_DATABASE_URL,
} from './returns-test.fixture.js'

const FIXED_NOW = new Date('2026-09-06T12:00:00.000Z')
const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

describe.skipIf(!postgresAvailable)('MarkInTransit/Reject/AdminOverride/RetryTransit — integration (DTJ-273)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repository: DrizzleReturnsRepository
  let ordersFacade: DrizzleReturnsOrdersFacadeAdapter
  let unitOfWork: DrizzleReturnsUnitOfWorkAdapter
  let outboxPort: DrizzleReturnsOutboxAdapter
  let deliveryPort: FakeReturnsDeliveryPort
  let markInTransit: MarkReturnInTransitUseCase
  let rejectReturn: RejectReturnUseCase
  let adminOverride: AdminOverrideReturnUseCase
  let retryTransit: RetryReturnTransitUseCase

  let tenantId: string
  let customerId: string
  let chainId: string
  let pharmacyId: string
  let orderId: string

  beforeAll(() => {
    ;({ pool, db } = connect())
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  afterEach(async () => {
    await cleanupTenant(db, tenantId)
    await cleanupPharmacy(db, pharmacyId, chainId)
  })

  async function setup(): Promise<void> {
    tenantId = await seedTenant(db)
    customerId = await seedUser(db, tenantId, 'customer')
    chainId = await seedChain(db)
    pharmacyId = await seedPharmacy(db, chainId)
    orderId = await seedOrder(db, { tenantId, customerId, pharmacyId, status: 'delivered', deliveredAt: FIXED_NOW })

    repository = new DrizzleReturnsRepository(db)
    ordersFacade = new DrizzleReturnsOrdersFacadeAdapter(db)
    unitOfWork = new DrizzleReturnsUnitOfWorkAdapter(db)
    outboxPort = new DrizzleReturnsOutboxAdapter(db)
    deliveryPort = new FakeReturnsDeliveryPort()

    markInTransit = new MarkReturnInTransitUseCase(repository, deliveryPort, unitOfWork, outboxPort)
    rejectReturn = new RejectReturnUseCase(repository, unitOfWork, outboxPort, { now: () => FIXED_NOW })
    adminOverride = new AdminOverrideReturnUseCase(repository, ordersFacade, unitOfWork, outboxPort, { now: () => FIXED_NOW })
    retryTransit = new RetryReturnTransitUseCase(repository, deliveryPort, unitOfWork, outboxPort)
  }

  function parseReason(raw: string): ReturnReason {
    const result = ReturnReason.parse(raw)
    if (isErr(result)) throw result.error
    return result.value
  }

  /** Заводит возврат НАПРЯМУЮ через домен (минуя `RequestReturnUseCase`) сразу в нужном статусе. */
  async function seedReturnInStatus(status: 'return_requested' | 'return_in_transit' | 'return_rejected'): Promise<string> {
    const requested = OrderReturn.request(
      {
        id: crypto.randomUUID(),
        orderId,
        reason: parseReason('defect'),
        initiatedBy: customerId,
        initiatorRole: 'customer',
        existingNonTerminalReturnIds: [],
      },
      FIXED_NOW,
    )
    if (status === 'return_requested') {
      await repository.save(requested)
      return requested.id
    }
    requested.markInTransit(customerId, Money.fromDiram(1000n))
    if (status === 'return_in_transit') {
      await repository.save(requested)
      return requested.id
    }
    requested.reject('packaging damaged in transit', FIXED_NOW)
    await repository.save(requested)
    return requested.id
  }

  it('MarkReturnInTransitUseCase — return_requested → return_in_transit, fee > 0, ReturnInTransitEvent публикован', async () => {
    await setup()
    const returnId = await seedReturnInStatus('return_requested')

    await markInTransit.execute({ tenantId, returnId, orderId, courierId: customerId })

    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_in_transit')
    expect(Number(row?.courierReturnFeeDiram)).toBeGreaterThan(0)
    const [outboxRow] = await db.select().from(outbox).where(eq(outbox.aggregateId, returnId))
    expect(outboxRow?.eventType).toBe('ReturnInTransitEvent')
  })

  it('RejectReturnUseCase — return_in_transit → return_rejected, checklistNotes=reason, ReturnRejectedEvent публикован', async () => {
    await setup()
    const returnId = await seedReturnInStatus('return_in_transit')

    await rejectReturn.execute({ tenantId, returnId, reason: 'packaging tampered' })

    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_rejected')
    expect(row?.checklistNotes).toBe('packaging tampered')
    expect(row?.resolvedAt).not.toBeNull()
    const [outboxRow] = await db.select().from(outbox).where(eq(outbox.aggregateId, returnId))
    expect(outboxRow?.eventType).toBe('ReturnRejectedEvent')
  })

  it('AdminOverrideReturnUseCase — super_admin переопределяет из return_rejected → return_confirmed, disposition=restock', async () => {
    await setup()
    const returnId = await seedReturnInStatus('return_rejected')
    const actor: ReturnsPolicyActor = { role: 'super_admin', pharmacyId: null, chainId: null }

    await adminOverride.execute({ tenantId, returnId, actorId: customerId, actor, reason: 'inspected personally, approved' })

    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_confirmed')
    expect(row?.disposition).toBe('restock')
    expect(row?.adminOverrideBy).toBe(customerId)
    const [outboxRow] = await db.select().from(outbox).where(eq(outbox.aggregateId, returnId))
    expect(outboxRow?.eventType).toBe('ReturnConfirmedEvent')
  })

  it('AdminOverrideReturnUseCase — pharmacy_admin ЧУЖОЙ сети → ForbiddenError, статус не меняется', async () => {
    await setup()
    const returnId = await seedReturnInStatus('return_rejected')
    const actor: ReturnsPolicyActor = { role: 'pharmacy_admin', pharmacyId: null, chainId: crypto.randomUUID() }

    await expect(
      adminOverride.execute({ tenantId, returnId, actorId: customerId, actor, reason: 'attempt' }),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_rejected')
  })

  it('AdminOverrideReturnUseCase — pharmacy_admin СВОЕЙ сети → успех', async () => {
    await setup()
    const returnId = await seedReturnInStatus('return_rejected')
    const actor: ReturnsPolicyActor = { role: 'pharmacy_admin', pharmacyId, chainId }

    await adminOverride.execute({ tenantId, returnId, actorId: customerId, actor, reason: 'same-chain admin approval' })

    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_confirmed')
  })

  it('RetryReturnTransitUseCase — return_rejected → return_in_transit, resolvedAt сброшен в NULL, fee > 0', async () => {
    await setup()
    const returnId = await seedReturnInStatus('return_rejected')

    await retryTransit.execute({ tenantId, returnId, orderId, courierId: customerId })

    const [row] = await db.select().from(orderReturns).where(eq(orderReturns.id, returnId))
    expect(row?.status).toBe('return_in_transit')
    expect(row?.resolvedAt).toBeNull()
    expect(Number(row?.courierReturnFeeDiram)).toBeGreaterThan(0)
  })
})
