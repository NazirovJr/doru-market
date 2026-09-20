/**
 * `ProposePartialFulfillmentUseCase` (DTJ-304, EP-12 §A.4, SRS-PHT-019/020, TC-PHT-009/010) —
 * unit-набор, порты замоканы (`InMemoryOrderRepository`/`PassthroughUnitOfWork` — тот же
 * приём, что `AcceptOrderUseCase`/`ReportItemIssueUseCase`). Реальный BullMQ/Postgres —
 * интеграционные тесты вне периметра этого набора (см. тест-план тикета).
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { BusinessRuleViolationError, ForbiddenError, NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order } from '@/modules/orders/domain/order.entity.js'
import type { OrderItemSnapshot } from '@/modules/orders/domain/order-item.entity.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import type { CatalogFacadePort, MedicineOrderSnapshot } from '@/modules/orders/application/ports/catalog-facade.port.js'
import type {
  CreatePartialFulfillmentRequestInput,
  PartialFulfillmentRequestRecord,
  PartialFulfillmentRequestRepositoryPort,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'
import type {
  PartialFulfillmentTimeoutQueuePort,
  SchedulePartialFulfillmentTimeoutInput,
} from '@/modules/orders/application/ports/partial-fulfillment-timeout-queue.port.js'
import { ProposePartialFulfillmentUseCase, type ProposePartialFulfillmentActor } from './propose-partial-fulfillment.use-case.js'

const NOW = new Date('2026-09-16T12:00:00.000Z')
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'
const TIMEOUT_MINUTES = 10
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111'

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

class SequentialIdGenerator implements IdGenerator {
  private counter = 0

  next(): string {
    this.counter += 1
    return `generated-id-${String(this.counter)}`
  }
}

const PHARMACIST_OWN: ProposePartialFulfillmentActor = { userId: 'pharmacist-1', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER: ProposePartialFulfillmentActor = {
  userId: 'pharmacist-2',
  role: 'pharmacist',
  tenantId: TENANT_ID,
  pharmacyId: 'pharmacy-2',
}
const PHARMACY_ADMIN: ProposePartialFulfillmentActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }

/** Заказ на 2 позиции — `unitPrice=10_000, quantity=2` каждая (см. `validOrderItemCommand`), т.е. `totalPrice=20_000` на позицию. */
function makeTwoItemOrder(): Order {
  const created = Order.create(
    validOrderCreateCommand({
      tenantId: TENANT_ID,
      pharmacyId: PHARMACY_ID,
      items: [validOrderItemCommand({ pharmacyId: PHARMACY_ID }), validOrderItemCommand({ pharmacyId: PHARMACY_ID })],
    }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return created.value
}

function withItemStatuses(order: Order, statuses: readonly OrderItemSnapshot['fulfillmentStatus'][]): Order {
  const snapshot = order.toSnapshot()
  return Order.restore({
    ...snapshot,
    items: snapshot.items.map((item, idx) => ({
      ...item,
      fulfillmentStatus: statuses[idx] ?? item.fulfillmentStatus,
      itemIssueReason: statuses[idx] === 'unavailable' ? 'out_of_stock' : item.itemIssueReason,
    })),
  })
}

interface Harness {
  readonly useCase: ProposePartialFulfillmentUseCase
  readonly repo: InMemoryOrderRepository
  readonly appendAll: ReturnType<typeof vi.fn<OrdersOutboxPort['appendAll']>>
  readonly schedule: ReturnType<typeof vi.fn<PartialFulfillmentTimeoutQueuePort['schedule']>>
  readonly createRequest: ReturnType<typeof vi.fn<PartialFulfillmentRequestRepositoryPort['create']>>
  readonly getTimeoutMinutes: ReturnType<typeof vi.fn<TenancyFacadePort['getPartialFulfillmentConfirmationTimeoutMinutes']>>
}

function toRecord(input: CreatePartialFulfillmentRequestInput): PartialFulfillmentRequestRecord {
  return { ...input, status: 'awaiting_customer', requestedAt: NOW, respondedAt: null }
}

function makeHarness(): Harness {
  const repo = new InMemoryOrderRepository()
  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const ordersOutbox: OrdersOutboxPort = { appendAll }
  const getTimeoutMinutes = vi
    .fn<TenancyFacadePort['getPartialFulfillmentConfirmationTimeoutMinutes']>()
    .mockResolvedValue(TIMEOUT_MINUTES)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes: vi.fn(),
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: getTimeoutMinutes,
    getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
    getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
  }
  const catalogFacade: CatalogFacadePort = {
    getMedicineSnapshot: vi.fn<CatalogFacadePort['getMedicineSnapshot']>().mockResolvedValue(new Map<string, MedicineOrderSnapshot>()),
    getSubstanceSet: vi.fn(),
    resolveMedicineIdByBarcode: vi.fn(),
  }
  const createRequest = vi.fn<PartialFulfillmentRequestRepositoryPort['create']>().mockImplementation((input) =>
    Promise.resolve(toRecord(input)),
  )
  const requestRepository: PartialFulfillmentRequestRepositoryPort = {
    create: createRequest,
    findById: vi.fn(),
    findLatestByOrderId: vi.fn(),
    transitionStatus: vi.fn(),
  }
  const schedule = vi.fn<PartialFulfillmentTimeoutQueuePort['schedule']>().mockResolvedValue(undefined)
  const timeoutQueue: PartialFulfillmentTimeoutQueuePort = { schedule }
  const useCase = new ProposePartialFulfillmentUseCase(
    repo,
    new PassthroughUnitOfWork(),
    ordersOutbox,
    tenancyFacade,
    catalogFacade,
    requestRepository,
    timeoutQueue,
    new FixedClock(),
    new SequentialIdGenerator(),
  )
  return { useCase, repo, appendAll, schedule, createRequest, getTimeoutMinutes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProposePartialFulfillmentUseCase — успешный путь (SRS-PHT-019/020, TC-PHT-009)', () => {
  it('все позиции решены, 1 unavailable → 201, request awaiting_customer, суммы посчитаны без unavailable-позиции', async () => {
    const { useCase, repo, createRequest } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })

    expect(result.status).toBe('awaiting_customer')
    expect(result.orderId).toBe(order.id)
    expect(result.itemsTotalBeforeDiram).toBe(40_000n) // 2 позиции × 20_000
    expect(result.itemsTotalAfterDiram).toBe(20_000n) // минус unavailable-позиция
    expect(result.refundAmountDiram).toBe(20_000n)
    expect(result.itemsSnapshot).toHaveLength(1)
    expect(result.itemsSnapshot[0]?.reason).toBe('out_of_stock')
    expect(createRequest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ idempotencyKey: IDEMPOTENCY_KEY, orderId: order.id, refundAmountDiram: 20_000n }),
      undefined,
    )
  })

  it('заказ В БД НЕ сохраняется — recalculateTotals() только предпросмотр, OrderRepositoryPort.save() не вызывается', async () => {
    const { useCase, repo } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)
    const saveSpy = vi.spyOn(repo, 'save')

    await useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })

    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('обе позиции unavailable → refundAmountDiram = itemsTotalBeforeDiram целиком', async () => {
    const { useCase, repo } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['unavailable', 'unavailable'])
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })

    expect(result.itemsTotalAfterDiram).toBe(0n)
    expect(result.refundAmountDiram).toBe(40_000n)
    expect(result.itemsSnapshot).toHaveLength(2)
  })

  it('планирует BullMQ джобу с jobId=requestId (через timeoutMinutes) В ТОЙ ЖЕ транзакции, что создание строки', async () => {
    const { useCase, repo, schedule } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })

    const expected: SchedulePartialFulfillmentTimeoutInput = { requestId: result.id, tenantId: TENANT_ID, timeoutMinutes: TIMEOUT_MINUTES }
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('публикует PartialFulfillmentProposedEvent в outbox с itemsSnapshot/refundAmountDiram/expiresAt', async () => {
    const { useCase, repo, appendAll } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)

    const result = await useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })

    expect(appendAll).toHaveBeenCalledExactlyOnceWith(
      TENANT_ID,
      [
        expect.objectContaining({
          type: 'PartialFulfillmentProposedEvent',
          orderId: order.id,
          requestId: result.id,
          refundAmountDiram: 20_000n,
        }),
      ],
      undefined,
    )
  })

  it('pharmacy_admin своей аптеки → 403 (РОВНО pharmacist, тот же RBAC, что scan/report-issue)', async () => {
    const { useCase, repo } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)

    await expect(
      useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACY_ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('ProposePartialFulfillmentUseCase — precondition (TC-PHT-010)', () => {
  it('≥1 позиция pending → 422 BUSINESS_RULE_VIOLATION, details.unresolvedItemIds непусто', async () => {
    const { useCase, repo, createRequest } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['unavailable', 'pending'])
    repo.seed(order)
    const pendingItemId = order.items[1]?.id

    const error = await useCase
      .execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BusinessRuleViolationError)
    expect((error as BusinessRuleViolationError).details).toEqual({ unresolvedItemIds: [pendingItemId] })
    expect(createRequest).not.toHaveBeenCalled()
  })

  it('0 unavailable (обе scanned_ok) → 422 BUSINESS_RULE_VIOLATION (нечего предлагать)', async () => {
    const { useCase, repo, createRequest } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'scanned_ok'])
    repo.seed(order)

    await expect(
      useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError)
    expect(createRequest).not.toHaveBeenCalled()
  })
})

describe('ProposePartialFulfillmentUseCase — авторизация и существование (SRS-API-043/046)', () => {
  it('несуществующий заказ → 404 NotFoundError', async () => {
    const { useCase } = makeHarness()
    await expect(
      useCase.execute({ orderId: randomUUID(), idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('чужой тенант → 404 NotFoundError (не 403)', async () => {
    const { useCase, repo } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)

    await expect(
      useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: { ...PHARMACIST_OWN, tenantId: 'tenant-2' } }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('pharmacist ДРУГОЙ аптеки → 403 ForbiddenError', async () => {
    const { useCase, repo } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)

    await expect(
      useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OTHER }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('ProposePartialFulfillmentUseCase — снэпшот названия медикамента (SRS-PHT-020)', () => {
  it('CatalogFacadePort.getMedicineSnapshot отсутствует запись → fallback на medicineId (не бросает)', async () => {
    const { useCase, repo } = makeHarness()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)
    const unavailableItem = order.items[1]
    if (unavailableItem === undefined) throw new Error('fixture: expected item')

    const result = await useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })

    expect(result.itemsSnapshot[0]?.medicineName).toBe(unavailableItem.medicineId)
  })

  it('CatalogFacadePort.getMedicineSnapshot возвращает tradeName → используется как medicineName', async () => {
    const repo = new InMemoryOrderRepository()
    const order = withItemStatuses(makeTwoItemOrder(), ['scanned_ok', 'unavailable'])
    repo.seed(order)
    const unavailableItem = order.items[1]
    if (unavailableItem === undefined) throw new Error('fixture: expected item')
    const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
    const tenancyFacade: TenancyFacadePort = {
      resolveCommissionRate: vi.fn(),
      getCodLimitDiram: vi.fn(),
      getEnabledPaymentMethods: vi.fn(),
      getPickupSlaMinutes: vi.fn(),
      getPickupSlaBufferMinutes: vi.fn(),
      getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn().mockResolvedValue(TIMEOUT_MINUTES),
      getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
      getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
    }
    const snapshotMap = new Map<string, MedicineOrderSnapshot>([
      [
        unavailableItem.medicineId,
        { medicineId: unavailableItem.medicineId, tradeName: 'Panadol', unitPriceDiram: 1_000n, isPrescriptionRequired: false, controlCategory: 'none' },
      ],
    ])
    const catalogFacade: CatalogFacadePort = {
      getMedicineSnapshot: vi.fn().mockResolvedValue(snapshotMap),
      getSubstanceSet: vi.fn(),
    } as unknown as CatalogFacadePort
    const requestRepository: PartialFulfillmentRequestRepositoryPort = {
      create: vi.fn().mockImplementation((input: CreatePartialFulfillmentRequestInput) => Promise.resolve(toRecord(input))),
      findById: vi.fn(),
      findLatestByOrderId: vi.fn(),
      transitionStatus: vi.fn(),
    }
    const timeoutQueue: PartialFulfillmentTimeoutQueuePort = { schedule: vi.fn().mockResolvedValue(undefined) }
    const useCase = new ProposePartialFulfillmentUseCase(
      repo,
      new PassthroughUnitOfWork(),
      { appendAll },
      tenancyFacade,
      catalogFacade,
      requestRepository,
      timeoutQueue,
      new FixedClock(),
      new SequentialIdGenerator(),
    )

    const result = await useCase.execute({ orderId: order.id, idempotencyKey: IDEMPOTENCY_KEY, actor: PHARMACIST_OWN })

    expect(result.itemsSnapshot[0]?.medicineName).toBe('Panadol')
  })
})
