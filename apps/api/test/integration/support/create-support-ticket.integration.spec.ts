/**
 * `CreateSupportTicketUseCase` — integration (EP-14, DTJ-279, тест-план тикета) — РЕАЛЬНЫЙ
 * Postgres, тот же приём подключения/пробы, что `create-payment-invoice.integration.spec.ts`
 * (payments, ближайший прецедент): конструирует адаптеры напрямую `new`, не через
 * `Test.createTestingModule`.
 *
 * Требует применённой миграции `0038_support_ticket_sla_fields.sql` (DTJ-278) — колонки
 * `support_tickets.first_response_due_at/first_responded_at/priority` и
 * `tenant_settings.support_first_response_sla_minutes`.
 *
 * Покрывает:
 *  - АС1/TC-ADM-021 — `is_escrow_blocking=false` в БД, ИСЧЕРПЫВАЮЩЕ для ВСЕХ 6 категорий
 *    (`SUPPORT_TICKET_CATEGORY_VALUES`), не только потенциально эскроу-блокирующих; `order_disputes`
 *    не создаётся ни для одной.
 *  - АС2 — `channel='system_auto'`, `createdBy=undefined` → тикет создан, `created_by IS NULL`.
 *  - АС3 — `customer` с ЧУЖИМ `orderId` → `ForbiddenError`, тикет не создан.
 *  - АС4 — `SupportTicketCreatedEvent` в `outbox` В ТОЙ ЖЕ транзакции, что `INSERT support_tickets`
 *    (единый `unitOfWork`): позитивный прогон (обе строки присутствуют) И негативный (сбой ПОСЛЕ
 *    `save()`+`append()` внутри транзакции откатывает ОБЕ записи — ни тикета, ни «сироты» в outbox).
 *  - per-tenant `supportFirstResponseSlaMinutes` реально влияет на `first_response_due_at` (не
 *    захардкожен), см. риск DTJ-279 «Риски» п.2.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { ForbiddenError, SUPPORT_TICKET_CATEGORY_VALUES, type SupportTicketChannel, type UserRole } from '@dorutj/contracts'
import { tenants, tenantSettings as tenantSettingsTable } from '@/db/schema/tenants.js'
import { users } from '@/db/schema/users.js'
import { orders } from '@/db/schema/orders.js'
import { supportTickets, orderDisputes } from '@/db/schema/support.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import { CreateSupportTicketUseCase, type CreateSupportTicketCommand } from '@/modules/support/application/use-cases/create-support-ticket.use-case.js'
import type { SupportOutboxPort } from '@/modules/support/application/ports/support-outbox.port.js'
import type { SupportTicketCreatedEvent } from '@/modules/support/domain/events/support-ticket-created.event.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { DrizzleSupportTicketsRepository } from '@/modules/support/infrastructure/repositories/drizzle-support-tickets.repository.js'
import { DrizzleSupportOrdersFacadeAdapter } from '@/modules/support/infrastructure/adapters/drizzle-support-orders-facade.adapter.js'
import { DrizzleSupportTenantSettingsAdapter } from '@/modules/support/infrastructure/adapters/drizzle-support-tenant-settings.adapter.js'
import { DrizzleSupportUnitOfWorkAdapter } from '@/modules/support/infrastructure/adapters/drizzle-support-unit-of-work.adapter.js'
import { DrizzleSupportOutboxAdapter } from '@/modules/support/infrastructure/adapters/drizzle-support-outbox.adapter.js'
import { SystemClockAdapter } from '@/shared-kernel/infrastructure/adapters/system-clock.adapter.js'
import { UuidV7IdGeneratorAdapter } from '@/shared-kernel/infrastructure/adapters/uuidv7-id-generator.adapter.js'

const TEST_DATABASE_URL =
  process.env.SUPPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'

const PROBE_TIMEOUT_MS = 1_500
const MS_PER_MINUTE = 60_000

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

/** Оборачивает РЕАЛЬНЫЙ `DrizzleSupportOutboxAdapter` и бросает ПОСЛЕ настоящей записи — симулирует
 *  сбой внутри транзакции ПОСЛЕ `outbox.append()`, чтобы доказать откат обеих записей (АС4). */
class ThrowsAfterRealAppendOutbox implements SupportOutboxPort {
  private readonly real: DrizzleSupportOutboxAdapter
  public constructor(db: NodePgDatabase) {
    this.real = new DrizzleSupportOutboxAdapter(db)
  }

  public async append(tenantId: string, event: SupportTicketCreatedEvent, tx: unknown): Promise<void> {
    await this.real.append(tenantId, event, tx)
    throw new Error('simulated failure AFTER outbox.append() inside the same unitOfWork transaction (DTJ-279 AC4)')
  }
}

describe.skipIf(!postgresAvailable)('CreateSupportTicketUseCase — integration (DTJ-279)', () => {
  let pool: Pool
  let db: NodePgDatabase
  let repository: DrizzleSupportTicketsRepository
  let ordersFacade: DrizzleSupportOrdersFacadeAdapter
  let tenantSettingsPort: DrizzleSupportTenantSettingsAdapter
  let unitOfWork: DrizzleSupportUnitOfWorkAdapter
  let outboxPort: DrizzleSupportOutboxAdapter
  let ids: UuidV7IdGeneratorAdapter
  let clock: SystemClockAdapter
  let useCase: CreateSupportTicketUseCase

  let tenantId: string
  let customerId: string
  let otherCustomerId: string
  let supportAgentId: string
  let orderId: string
  let otherOrderId: string

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL })
    db = drizzle(pool)
  })

  afterAll(async () => {
    await pool.end().catch(() => undefined)
  })

  function nextOrderNumber(): string {
    return `DTJ279-${randomUUID().slice(0, 8)}`
  }

  async function seedOrder(forCustomerId: string): Promise<string> {
    const id = randomUUID()
    await db.insert(orders).values({
      id,
      orderNumber: nextOrderNumber(),
      customerId: forCustomerId,
      paymentMethod: 'cash_courier',
      // `cash_courier` НИКОГДА не в 'pending_payment'/'paid_escrow' (chk_orders_cash_never_escrow,
      // D-25/SRS-ORD-027) — default-статус нарушил бы констрейнт, нужен явный терминальный/промежуточный.
      status: 'confirmed',
      itemsTotalTjs: '50.00',
      deliveryFeeTjs: '0.00',
      totalAmountTjs: '50.00',
      deliveryAddress: 'Dushanbe, DTJ-279 test str. 1',
      tenantId,
      checkoutAttemptId: randomUUID(),
    })
    return id
  }

  beforeEach(async () => {
    tenantId = randomUUID()
    await db.insert(tenants).values({ id: tenantId, slug: `dtj279-${tenantId.slice(0, 8)}`, isNeutral: false })

    customerId = randomUUID()
    otherCustomerId = randomUUID()
    supportAgentId = randomUUID()
    await db.insert(users).values([
      { id: customerId, tenantId, role: 'customer' },
      { id: otherCustomerId, tenantId, role: 'customer' },
      { id: supportAgentId, tenantId, role: 'support_agent' },
    ])

    orderId = await seedOrder(customerId)
    otherOrderId = await seedOrder(otherCustomerId)

    repository = new DrizzleSupportTicketsRepository(db)
    ordersFacade = new DrizzleSupportOrdersFacadeAdapter(db)
    tenantSettingsPort = new DrizzleSupportTenantSettingsAdapter(db)
    unitOfWork = new DrizzleSupportUnitOfWorkAdapter(db)
    outboxPort = new DrizzleSupportOutboxAdapter(db)
    ids = new UuidV7IdGeneratorAdapter()
    clock = new SystemClockAdapter()
    useCase = new CreateSupportTicketUseCase(repository, ordersFacade, tenantSettingsPort, unitOfWork, outboxPort, ids, clock)
  })

  afterEach(async () => {
    await db.delete(orderDisputes).where(eq(orderDisputes.orderId, orderId)).catch(() => undefined)
    await db.delete(orderDisputes).where(eq(orderDisputes.orderId, otherOrderId)).catch(() => undefined)
    await db.delete(supportTickets).where(eq(supportTickets.tenantId, tenantId)).catch(() => undefined)
    await db.delete(outbox).where(eq(outbox.tenantId, tenantId)).catch(() => undefined)
    await db.delete(orders).where(eq(orders.tenantId, tenantId)).catch(() => undefined)
    await db.delete(users).where(eq(users.tenantId, tenantId)).catch(() => undefined)
    await db.delete(tenants).where(eq(tenants.id, tenantId)).catch(() => undefined)
  })

  /** `orderId`/`createdBy` — `| undefined` явно (не просто `?:`): под `exactOptionalPropertyTypes`
   *  это единственный способ явно передать «поле отсутствует» из вызывающего теста. Финальный
   *  объект строится conditional-spread'ом (тот же приём, что use case) — без буквального
   *  `key: undefined` в результирующей команде. */
  interface CommandOpts {
    readonly channel: SupportTicketChannel
    readonly category: string
    readonly actorRole: UserRole
    readonly orderId?: string | undefined
    readonly createdBy?: string | undefined
  }

  function buildCommand(opts: CommandOpts): CreateSupportTicketCommand {
    return {
      tenantId,
      channel: opts.channel,
      category: opts.category,
      actorRole: opts.actorRole,
      ...(opts.orderId !== undefined && { orderId: opts.orderId }),
      ...(opts.createdBy !== undefined && { createdBy: opts.createdBy }),
    }
  }

  it.each(SUPPORT_TICKET_CATEGORY_VALUES)(
    'AC1/TC-ADM-021 — категория "%s": is_escrow_blocking=false в БД, order_disputes НЕ создаётся (исчерпывающе для всех 6 категорий)',
    async (category) => {
      const result = await useCase.execute(
        buildCommand({ channel: 'in_app', category, orderId, createdBy: customerId, actorRole: 'customer' }),
      )

      const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, result.ticketId))
      expect(row?.isEscrowBlocking).toBe(false)
      expect(row?.category).toBe(category)
      expect(row?.status).toBe('open')

      const disputes = await db.select().from(orderDisputes).where(eq(orderDisputes.orderId, orderId))
      expect(disputes).toHaveLength(0)
    },
  )

  it('AC2 — channel=system_auto, createdBy=undefined → тикет создан, created_by IS NULL', async () => {
    const result = await useCase.execute(
      buildCommand({ channel: 'system_auto', category: 'other', orderId: undefined, createdBy: undefined, actorRole: 'customer' }),
    )

    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, result.ticketId))
    expect(row?.createdBy).toBeNull()
    expect(row?.orderId).toBeNull()
  })

  it('channel=system_auto С orderId (авто-тикет SLA-джобы) — проверка владения ПРОПУСКАЕТСЯ', async () => {
    // orderId принадлежит otherCustomerId, НЕ customerId — если бы проверка владения выполнялась,
    // это провалило бы её; channel='system_auto' обязан пропустить её безусловно.
    const result = await useCase.execute(
      buildCommand({ channel: 'system_auto', category: 'other', orderId: otherOrderId, createdBy: undefined, actorRole: 'customer' }),
    )

    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, result.ticketId))
    expect(row?.orderId).toBe(otherOrderId)
  })

  it('AC3 — customer с ЧУЖИМ orderId → ForbiddenError, тикет НЕ создан', async () => {
    const before = await db.select().from(supportTickets).where(eq(supportTickets.tenantId, tenantId))
    expect(before).toHaveLength(0)

    await expect(
      useCase.execute(
        buildCommand({ channel: 'in_app', category: 'other', orderId: otherOrderId, createdBy: customerId, actorRole: 'customer' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    const after = await db.select().from(supportTickets).where(eq(supportTickets.tenantId, tenantId))
    expect(after).toHaveLength(0)
  })

  it('customer со СВОИМ orderId → тикет создан с этим orderId', async () => {
    const result = await useCase.execute(
      buildCommand({ channel: 'in_app', category: 'other', orderId, createdBy: customerId, actorRole: 'customer' }),
    )

    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, result.ticketId))
    expect(row?.orderId).toBe(orderId)
  })

  it('actorRole=support_agent с ЧУЖИМ (для него) orderId — проверка владения ПРОПУСКАЕТСЯ, тикет создан', async () => {
    const result = await useCase.execute(
      buildCommand({ channel: 'phone', category: 'other', orderId, createdBy: supportAgentId, actorRole: 'support_agent' }),
    )

    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, result.ticketId))
    expect(row?.createdBy).toBe(supportAgentId)
  })

  it('AC4 (позитив) — SupportTicketCreatedEvent опубликован в outbox В ТОЙ ЖЕ транзакции, что INSERT support_tickets', async () => {
    const result = await useCase.execute(
      buildCommand({ channel: 'in_app', category: 'payment_issue', orderId, createdBy: customerId, actorRole: 'customer' }),
    )

    const [ticketRow] = await db.select().from(supportTickets).where(eq(supportTickets.id, result.ticketId))
    expect(ticketRow).toBeDefined()

    const [outboxRow] = await db.select().from(outbox).where(eq(outbox.aggregateId, result.ticketId))
    expect(outboxRow).toBeDefined()
    expect(outboxRow?.eventType).toBe('SupportTicketCreatedEvent')
    expect(outboxRow?.aggregateType).toBe('support_ticket')
    expect(outboxRow?.tenantId).toBe(tenantId)
    const payload = outboxRow?.payload as SupportTicketCreatedEvent
    expect(payload).toMatchObject({
      type: 'SupportTicketCreatedEvent',
      ticketId: result.ticketId,
      tenantId,
      orderId,
      category: 'payment_issue',
      channel: 'in_app',
      priority: 0,
    })
  })

  it('AC4 (негатив) — сбой ПОСЛЕ save()+outbox.append() внутри unitOfWork откатывает ОБЕ записи (ни тикета, ни «сироты» в outbox)', async () => {
    const poisonedUseCase = new CreateSupportTicketUseCase(
      repository,
      ordersFacade,
      tenantSettingsPort,
      unitOfWork,
      new ThrowsAfterRealAppendOutbox(db),
      ids,
      clock,
    )

    await expect(
      poisonedUseCase.execute(
        buildCommand({ channel: 'in_app', category: 'other', orderId, createdBy: customerId, actorRole: 'customer' }),
      ),
    ).rejects.toThrow(/simulated failure AFTER outbox\.append/)

    const ticketRows = await db.select().from(supportTickets).where(eq(supportTickets.tenantId, tenantId))
    expect(ticketRows).toHaveLength(0)
    const outboxRows = await db.select().from(outbox).where(eq(outbox.tenantId, tenantId))
    expect(outboxRows).toHaveLength(0)
  })

  it('firstResponseDueAt считается из tenantSettings.supportFirstResponseSlaMinutes КОНКРЕТНОГО тенанта, не хардкод 60 (DTJ-279 «Риски» п.2)', async () => {
    const CUSTOM_SLA_MINUTES = 45
    await db
      .insert(tenantSettingsTable)
      .values({ tenantId, brandName: 'DTJ-279 Test Brand', supportFirstResponseSlaMinutes: CUSTOM_SLA_MINUTES })

    const fixedNow = new Date('2026-09-04T10:00:00.000Z')
    const fixedClock: Clock = { now: () => fixedNow }
    const customUseCase = new CreateSupportTicketUseCase(
      repository,
      ordersFacade,
      tenantSettingsPort,
      unitOfWork,
      outboxPort,
      ids,
      fixedClock,
    )

    const result = await customUseCase.execute(
      buildCommand({ channel: 'in_app', category: 'other', orderId, createdBy: customerId, actorRole: 'customer' }),
    )

    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, result.ticketId))
    const expectedDueAtMs = fixedNow.getTime() + CUSTOM_SLA_MINUTES * MS_PER_MINUTE
    expect(row?.firstResponseDueAt?.getTime()).toBe(expectedDueAtMs)
  })
})
