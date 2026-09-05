/**
 * `ReclaimOrderUseCase` (DTJ-301, SRS-PHT-010) — не трогает `sla_deadline_at`/прогресс
 * сканирования (тест-план тикета), доступен ЛЮБОМУ `pharmacist`/`pharmacy_admin` той же аптеки.
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { isOk } from '@dorutj/domain-kernel'
import { ForbiddenError, NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import { ReclaimOrderUseCase, type ReclaimOrderActor } from './reclaim-order.use-case.js'

const NOW = new Date('2026-09-05T12:10:00.000Z')
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'
const SLA_DEADLINE = new Date('2026-09-05T12:07:00.000Z')
const PROCESSING_STARTED_AT = new Date('2026-09-05T12:00:00.000Z')

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

class PassthroughUnitOfWork implements OrdersUnitOfWorkPort {
  async run<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    return callback(undefined)
  }
}

const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

function processingOrder(overrides: Partial<OrderSnapshot> = {}): Order {
  const created = Order.create(validOrderCreateCommand({ tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }))
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({
    ...created.value.toSnapshot(),
    status: 'processing',
    processingStartedAt: PROCESSING_STARTED_AT,
    slaDeadlineAt: SLA_DEADLINE,
    ...overrides,
  })
}

const PHARMACIST_A_ID = 'pharmacist-a'
const PHARMACIST_B: ReclaimOrderActor = { userId: 'pharmacist-b', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACY_ADMIN: ReclaimOrderActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER_PHARMACY: ReclaimOrderActor = {
  userId: 'pharmacist-c',
  role: 'pharmacist',
  tenantId: TENANT_ID,
  pharmacyId: 'pharmacy-2',
}

interface Harness {
  readonly useCase: ReclaimOrderUseCase
  readonly repo: InMemoryOrderRepository
  readonly appendAll: ReturnType<typeof vi.fn<OrdersOutboxPort['appendAll']>>
}

function makeHarness(): Harness {
  const repo = new InMemoryOrderRepository()
  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const ordersOutbox: OrdersOutboxPort = { appendAll }
  const useCase = new ReclaimOrderUseCase(repo, new PassthroughUnitOfWork(), ordersOutbox, new FixedClock(), SILENT_LOGGER)
  return { useCase, repo, appendAll }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReclaimOrderUseCase — успех (TC-PHT-003, SRS-PHT-010)', () => {
  it('заказ в работе у A, B вызывает reclaim(shift_change) → assignedPharmacistId=B, slaDeadlineAt НЕ изменился', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder()
    repo.seed(order, { id: PHARMACIST_A_ID, name: 'Фарзона М.' })

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_B, reason: 'shift_change' })

    expect(result.assignedPharmacistId).toBe(PHARMACIST_B.userId)
    expect(result.slaDeadlineAt).toEqual(SLA_DEADLINE)
    const locked = await repo.findByIdForUpdate(TENANT_ID, order.id, undefined)
    expect(locked?.assignedPharmacistId).toBe(PHARMACIST_B.userId)
  })

  it('НЕ трогает order.status/processingStartedAt (никакой доменной мутации, order_items не читаются/не пишутся)', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder()
    repo.seed(order, { id: PHARMACIST_A_ID, name: null })

    await useCase.execute({ orderId: order.id, actor: PHARMACIST_B, reason: 'colleague_unavailable' })

    const saved = await repo.findById(TENANT_ID, order.id)
    const snapshot = saved?.toSnapshot()
    expect(saved?.status).toBe('processing')
    expect(snapshot?.processingStartedAt).toEqual(PROCESSING_STARTED_AT)
    expect(snapshot?.slaDeadlineAt).toEqual(SLA_DEADLINE)
  })

  it('публикует OrderReclaimedEvent с previousPharmacistId/newPharmacistId/reason корректно', async () => {
    const { useCase, repo, appendAll } = makeHarness()
    const order = processingOrder()
    repo.seed(order, { id: PHARMACIST_A_ID, name: null })

    await useCase.execute({ orderId: order.id, actor: PHARMACIST_B, reason: 'other', note: 'терминал завис' })

    // `toHaveBeenCalledWith` требует ТОЧНОГО совпадения арности — `appendAll(tenantId, events, tx)`
    // передаёт 3-й аргумент (`tx`, здесь `undefined` от `PassthroughUnitOfWork`) — извлекаем
    // конкретные позиции, не сравниваем весь список аргументов целиком.
    const [calledTenantId, calledEvents] = appendAll.mock.calls[0] ?? []
    expect(calledTenantId).toBe(TENANT_ID)
    expect(calledEvents).toEqual([
      expect.objectContaining({
        type: 'OrderReclaimedEvent',
        orderId: order.id,
        previousPharmacistId: PHARMACIST_A_ID,
        newPharmacistId: PHARMACIST_B.userId,
        reason: 'other',
        at: NOW,
      }),
    ])
  })

  it('pharmacy_admin своей аптеки — тоже может перехватить', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder()
    repo.seed(order, { id: PHARMACIST_A_ID, name: null })

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACY_ADMIN, reason: 'shift_change' })

    expect(result.assignedPharmacistId).toBe(PHARMACY_ADMIN.userId)
  })

  it('«самоперехват» (B перехватывает у самого себя) — валидный no-op-подобный сценарий, не отклоняется', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder()
    repo.seed(order, { id: PHARMACIST_B.userId, name: null })

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_B, reason: 'other' })

    expect(result.assignedPharmacistId).toBe(PHARMACIST_B.userId)
  })
})

describe('ReclaimOrderUseCase — авторизация/статус (403/404)', () => {
  it('pharmacist чужой аптеки → ForbiddenError', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder()
    repo.seed(order, { id: PHARMACIST_A_ID, name: null })

    await expect(
      useCase.execute({ orderId: order.id, actor: PHARMACIST_OTHER_PHARMACY, reason: 'shift_change' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('заказ ещё НЕ в processing (paid_escrow, нечего перехватывать) → ForbiddenError', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder({ status: 'paid_escrow', processingStartedAt: null, slaDeadlineAt: null })
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: PHARMACIST_B, reason: 'shift_change' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('чужой тенант → NotFoundError', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder()
    repo.seed(order, { id: PHARMACIST_A_ID, name: null })

    await expect(
      useCase.execute({ orderId: order.id, actor: { ...PHARMACIST_B, tenantId: 'tenant-2' }, reason: 'shift_change' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('несуществующий заказ → NotFoundError', async () => {
    const { useCase } = makeHarness()

    await expect(useCase.execute({ orderId: randomUUID(), actor: PHARMACIST_B, reason: 'shift_change' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('ReclaimOrderUseCase — защита от испорченных данных', () => {
  it('processing БЕЗ assigned_pharmacist_id (структурно недостижимо штатным путём) → бросает Error, не DomainError', async () => {
    const { useCase, repo } = makeHarness()
    const order = processingOrder()
    repo.seed(order, null) // намеренно испорченное состояние — see JSDoc use case'а

    await expect(useCase.execute({ orderId: order.id, actor: PHARMACIST_B, reason: 'shift_change' })).rejects.toThrow(
      /data integrity violation/,
    )
  })
})
