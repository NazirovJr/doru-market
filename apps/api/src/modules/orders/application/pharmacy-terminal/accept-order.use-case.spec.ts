/**
 * `AcceptOrderUseCase` (DTJ-301, SRS-PHT-007/008/009) — unit-набор, порты замоканы
 * (`InMemoryOrderRepository`/`PassthroughUnitOfWork` — тот же приём, что `checkout.use-case.spec.ts`).
 * Реальный `SELECT ... FOR UPDATE`/конкурентный `accept` (TC-PHT-023) — интеграционный тест на
 * живом Postgres, вне периметра этого набора (см. тест-план тикета).
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { ExpiredStockError, ForbiddenError, NotFoundError, OrderAlreadyClaimedError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { AcceptOrderUseCase, type AcceptOrderActor } from './accept-order.use-case.js'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'

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

function orderAtStatus(status: OrderSnapshot['status'], overrides: Partial<OrderSnapshot> = {}): Order {
  const paymentMethod = status === 'confirmed' ? 'cash_courier' : overrides.paymentMethod ?? 'alif_mobi'
  const created = Order.create(
    validOrderCreateCommand({ tenantId: TENANT_ID, pharmacyId: PHARMACY_ID, paymentMethod }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status, ...overrides })
}

const PHARMACIST_A: AcceptOrderActor = { userId: 'pharmacist-a', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_B: AcceptOrderActor = { userId: 'pharmacist-b', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER_PHARMACY: AcceptOrderActor = {
  userId: 'pharmacist-c',
  role: 'pharmacist',
  tenantId: TENANT_ID,
  pharmacyId: 'pharmacy-2',
}
const PHARMACY_ADMIN: AcceptOrderActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }

interface Harness {
  readonly useCase: AcceptOrderUseCase
  readonly repo: InMemoryOrderRepository
  readonly appendAll: ReturnType<typeof vi.fn<OrdersOutboxPort['appendAll']>>
  readonly hasExpiredReservedBatch: ReturnType<typeof vi.fn<InventoryFacadePort['hasExpiredReservedBatch']>>
  readonly getPickupSlaMinutes: ReturnType<typeof vi.fn<TenancyFacadePort['getPickupSlaMinutes']>>
}

function makeHarness(pickupSlaMinutes = 7): Harness {
  const repo = new InMemoryOrderRepository()
  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const ordersOutbox: OrdersOutboxPort = { appendAll }
  const hasExpiredReservedBatch = vi.fn<InventoryFacadePort['hasExpiredReservedBatch']>().mockResolvedValue(false)
  const inventoryFacade: InventoryFacadePort = {
    reserveStock: vi.fn(),
    releaseStock: vi.fn(),
    hasExpiredReservedBatch,
    getStockQuantity: vi.fn(),
    reserveForOrder: vi.fn(),
    reconcileZeroStock: vi.fn(),
  }
  const getPickupSlaMinutes = vi.fn<TenancyFacadePort['getPickupSlaMinutes']>().mockResolvedValue(pickupSlaMinutes)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes,
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
    getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
    getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
  }
  const useCase = new AcceptOrderUseCase(repo, new PassthroughUnitOfWork(), ordersOutbox, inventoryFacade, tenancyFacade, new FixedClock())
  return { useCase, repo, appendAll, hasExpiredReservedBatch, getPickupSlaMinutes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AcceptOrderUseCase — успех (SRS-PHT-007/008)', () => {
  it('TC-PHT-001: paid_escrow, свободен → 200-эквивалент: processing, slaDeadlineAt=now+7мин, assignedPharmacistId=A', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_A })

    expect(result.status).toBe('processing')
    expect(result.assignedPharmacistId).toBe(PHARMACIST_A.userId)
    expect(result.slaDeadlineAt).toEqual(new Date('2026-09-05T12:07:00.000Z'))
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('processing')
    const locked = await repo.findByIdForUpdate(TENANT_ID, order.id, undefined)
    expect(locked?.assignedPharmacistId).toBe(PHARMACIST_A.userId)
  })

  it('публикует OrderProcessingStartedEvent И OrderClaimedEvent В ОДНОЙ записи appendAll (SRS-PHT-007 п.4)', async () => {
    const { useCase, repo, appendAll } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await useCase.execute({ orderId: order.id, actor: PHARMACIST_A })

    expect(appendAll).toHaveBeenCalledTimes(1)
    const [tenantId, events] = appendAll.mock.calls[0] ?? []
    expect(tenantId).toBe(TENANT_ID)
    expect(events).toEqual([
      expect.objectContaining({ type: 'OrderProcessingStartedEvent', orderId: order.id, pharmacistId: PHARMACIST_A.userId }),
      expect.objectContaining({ type: 'OrderClaimedEvent', orderId: order.id, pharmacistId: PHARMACIST_A.userId, claimedAt: NOW }),
    ])
  })

  it('confirmed (cash_courier) — тоже допустим (SRS-PHT-007, обе ветки D-25)', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('confirmed')
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_A })

    expect(result.status).toBe('processing')
  })

  it('pharmacy_admin своей аптеки — тоже может принять (SRS-PHT-004)', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACY_ADMIN })

    expect(result.assignedPharmacistId).toBe(PHARMACY_ADMIN.userId)
  })

  it('pickup_sla_minutes читается из TenancyFacadePort (не хардкод 7)', async () => {
    const { useCase, repo, getPickupSlaMinutes } = makeHarness(15)
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, actor: PHARMACIST_A })

    expect(getPickupSlaMinutes).toHaveBeenCalledWith(TENANT_ID)
    expect(result.slaDeadlineAt).toEqual(new Date('2026-09-05T12:15:00.000Z'))
  })
})

describe('AcceptOrderUseCase — гонка «уже принят» (TC-PHT-002, SRS-PHT-009)', () => {
  it('заказ уже принят A → B получает OrderAlreadyClaimedError с details.assignedPharmacistId=A, статус не меняется', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('processing', { processingStartedAt: NOW })
    repo.seed(order, { id: PHARMACIST_A.userId, name: 'Фарзона М.' })

    const error = await useCase.execute({ orderId: order.id, actor: PHARMACIST_B }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OrderAlreadyClaimedError)
    const details = (error as OrderAlreadyClaimedError).details
    expect(details).toEqual(
      expect.objectContaining({ assignedPharmacistId: PHARMACIST_A.userId, assignedPharmacistName: 'Фарзона М.' }),
    )
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('processing') // не сброшено повторным вызовом
  })

  it('assignedPharmacistName неизвестен (пользователь не найден) → details.assignedPharmacistName=null, не бросает', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('processing', { processingStartedAt: NOW })
    repo.seed(order, { id: 'ghost-user', name: null })

    const error = await useCase.execute({ orderId: order.id, actor: PHARMACIST_B }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(OrderAlreadyClaimedError)
    expect((error as OrderAlreadyClaimedError).details).toEqual(
      expect.objectContaining({ assignedPharmacistId: 'ghost-user', assignedPharmacistName: null }),
    )
  })
})

describe('AcceptOrderUseCase — авторизация/статус (403/404)', () => {
  it('пharmacist чужой аптеки → ForbiddenError', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: PHARMACIST_OTHER_PHARMACY })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('заказ уже cancelled (без assigned_pharmacist_id) → ForbiddenError, НЕ ORDER_ALREADY_CLAIMED', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('cancelled')
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: PHARMACIST_A })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('чужой тенант → NotFoundError (SRS-API-046, не 403)', async () => {
    const { useCase, repo } = makeHarness()
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await expect(
      useCase.execute({ orderId: order.id, actor: { ...PHARMACIST_A, tenantId: 'tenant-2' } }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('несуществующий заказ → NotFoundError', async () => {
    const { useCase } = makeHarness()

    await expect(useCase.execute({ orderId: randomUUID(), actor: PHARMACIST_A })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('AcceptOrderUseCase — партия просрочена (SRS-DOM-006, defense-in-depth)', () => {
  it('hasExpiredReservedBatch=true → ExpiredStockError, заказ НЕ переведён в processing', async () => {
    const { useCase, repo, hasExpiredReservedBatch } = makeHarness()
    hasExpiredReservedBatch.mockResolvedValue(true)
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)

    await expect(useCase.execute({ orderId: order.id, actor: PHARMACIST_A })).rejects.toBeInstanceOf(ExpiredStockError)

    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('paid_escrow')
  })
})
