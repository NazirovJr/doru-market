/**
 * `CompletePickingUseCase` (DTJ-305, EP-12 §A.5, SRS-PHT-024..027, TC-PHT-014/015/016) —
 * три precondition-ветки (а/б/в) каждая отдельным кейсом (тест-план тикета), проверка, что
 * `OtpGeneratorPort.generate()` вызывается РОВНО один раз на успешный вызов, RBAC/NotFound —
 * тот же приём, что `ScanOrderItemUseCase`/`ReportItemIssueUseCase`. Порты замоканы/фейкнуты —
 * реальный Postgres вне периметра этого набора.
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { isOk } from '@dorutj/domain-kernel'
import {
  BusinessRuleViolationError,
  ExpiredStockError,
  ForbiddenError,
  NotFoundError,
  PendingCustomerConfirmationError,
  SealConfirmationRequiredError,
} from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type { IdGenerator } from '@/shared-kernel/application/ports/id-generator.port.js'
import type { OtpCodesRepository, OtpGeneratorPort } from '@/modules/auth/index.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import type {
  PartialFulfillmentRequestRecord,
  PartialFulfillmentRequestRepositoryPort,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'
import { CompletePickingUseCase, type CompletePickingActor, type CompletePickingCommand } from './complete-picking.use-case.js'

const NOW = new Date('2026-09-16T12:00:00.000Z')
const HANDOVER_OTP_TTL_MS = 900_000 // 15 минут (SRS-DOM-080)
const TENANT_ID = 'tenant-1'
const PHARMACY_ID = 'pharmacy-1'
const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

class FixedClock implements Clock {
  now(): Date {
    return NOW
  }
}

class SequentialIdGenerator implements IdGenerator {
  private counter = 0

  next(): string {
    this.counter += 1
    return `otp-id-${String(this.counter)}`
  }
}

const PASSTHROUGH_UOW: OrdersUnitOfWorkPort = { run: (callback) => callback(undefined) }

const PHARMACIST_OWN: CompletePickingActor = { userId: 'pharmacist-1', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER: CompletePickingActor = { userId: 'pharmacist-2', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: 'pharmacy-2' }
const PHARMACY_ADMIN: CompletePickingActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }

/** Заказ `status='processing'`, N позиций — `itemStatuses` задаёт `fulfillmentStatus` каждой по порядку. */
function makeOrder(itemStatuses: readonly OrderSnapshot['items'][number]['fulfillmentStatus'][]): Order {
  const created = Order.create(
    validOrderCreateCommand({
      tenantId: TENANT_ID,
      pharmacyId: PHARMACY_ID,
      items: itemStatuses.map(() => validOrderItemCommand({ pharmacyId: PHARMACY_ID })),
    }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  const snapshot = created.value.toSnapshot()
  return Order.restore({
    ...snapshot,
    status: 'processing',
    items: snapshot.items.map((item, idx) => ({
      ...item,
      fulfillmentStatus: itemStatuses[idx] ?? 'pending',
      scannedBatchId: itemStatuses[idx] === 'scanned_ok' ? item.inventoryBatchId : null,
      itemIssueReason: itemStatuses[idx] === 'unavailable' ? 'out_of_stock' : null,
    })),
  })
}

function makeRequest(orderId: string, overrides: Partial<PartialFulfillmentRequestRecord> = {}): PartialFulfillmentRequestRecord {
  return {
    id: randomUUID(),
    orderId,
    proposedBy: 'pharmacist-1',
    itemsSnapshot: [],
    itemsTotalBeforeDiram: 40_000n,
    itemsTotalAfterDiram: 20_000n,
    refundAmountDiram: 20_000n,
    status: 'confirmed',
    idempotencyKey: randomUUID(),
    requestedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 600_000),
    respondedAt: NOW,
    ...overrides,
  }
}

interface Harness {
  readonly useCase: CompletePickingUseCase
  readonly orderRepo: InMemoryOrderRepository
  readonly appendAll: ReturnType<typeof vi.fn<OrdersOutboxPort['appendAll']>>
  readonly hasExpiredReservedBatch: ReturnType<typeof vi.fn<InventoryFacadePort['hasExpiredReservedBatch']>>
  readonly findLatestByOrderId: ReturnType<typeof vi.fn<PartialFulfillmentRequestRepositoryPort['findLatestByOrderId']>>
  readonly otpGenerate: ReturnType<typeof vi.fn<OtpGeneratorPort['generate']>>
  readonly otpCodesCreate: ReturnType<typeof vi.fn<OtpCodesRepository['create']>>
}

function makeHarness(): Harness {
  const orderRepo = new InMemoryOrderRepository()
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
  const findLatestByOrderId = vi.fn<PartialFulfillmentRequestRepositoryPort['findLatestByOrderId']>().mockResolvedValue(null)
  const requestRepository: PartialFulfillmentRequestRepositoryPort = {
    create: vi.fn(),
    findById: vi.fn(),
    findLatestByOrderId,
    transitionStatus: vi.fn(),
  }
  const otpGenerate = vi.fn<OtpGeneratorPort['generate']>().mockReturnValue({ code: '4821', codeHash: 'unsalted-hash' })
  const otpGenerator: OtpGeneratorPort = { generate: otpGenerate }
  const otpCodesCreate = vi.fn<OtpCodesRepository['create']>().mockImplementation((input) =>
    Promise.resolve({ ...input, attempts: 0, consumedAt: null }),
  )
  const otpCodesRepository: OtpCodesRepository = {
    create: otpCodesCreate,
    findByIdForUpdate: vi.fn(),
    markConsumed: vi.fn(),
    incrementAttempts: vi.fn(),
    findActiveBySubject: vi.fn(),
  }
  const useCase = new CompletePickingUseCase(
    orderRepo,
    PASSTHROUGH_UOW,
    ordersOutbox,
    inventoryFacade,
    requestRepository,
    otpGenerator,
    otpCodesRepository,
    new FixedClock(),
    new SequentialIdGenerator(),
    SILENT_LOGGER,
  )
  return { useCase, orderRepo, appendAll, hasExpiredReservedBatch, findLatestByOrderId, otpGenerate, otpCodesCreate }
}

function cmd(orderId: string, overrides: Partial<CompletePickingCommand> = {}): CompletePickingCommand {
  return { orderId, sealConfirmed: true, actor: PHARMACIST_OWN, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CompletePickingUseCase — sealConfirmed=false (SRS-PHT-025, TC-PHT-015)', () => {
  it('бросает SealConfirmationRequiredError, заказ НЕ переходит в picked_up, OTP не генерируется', async () => {
    const { useCase, orderRepo, otpGenerate } = makeHarness()
    const order = makeOrder(['scanned_ok', 'scanned_ok'])
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id, { sealConfirmed: false }))).rejects.toBeInstanceOf(SealConfirmationRequiredError)

    const saved = await orderRepo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('processing')
    expect(otpGenerate).not.toHaveBeenCalled()
  })
})

describe('CompletePickingUseCase — success (SRS-PHT-027, TC-PHT-016)', () => {
  it('все scanned_ok → 200, status=picked_up, handoverOtp {code, expiresAt=now+15мин, purpose}, generate() вызван РОВНО один раз', async () => {
    const { useCase, orderRepo, appendAll, otpGenerate, otpCodesCreate } = makeHarness()
    const order = makeOrder(['scanned_ok', 'scanned_ok'])
    orderRepo.seed(order)

    const result = await useCase.execute(cmd(order.id))

    expect(result).toEqual({
      orderId: order.id,
      status: 'picked_up',
      handoverOtp: { code: '4821', expiresAt: new Date(NOW.getTime() + HANDOVER_OTP_TTL_MS), purpose: 'delivery_handover' },
    })
    expect(otpGenerate).toHaveBeenCalledTimes(1)
    expect(otpGenerate).toHaveBeenCalledWith('delivery_handover')
    expect(otpCodesCreate).toHaveBeenCalledTimes(1)
    expect(otpCodesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, subjectRef: order.id, purpose: 'delivery_handover' }),
    )
    const saved = await orderRepo.findById(TENANT_ID, order.id)
    expect(saved?.status).toBe('picked_up')
    expect(saved?.toSnapshot().handoverOtpId).toBe('otp-id-1')
    expect(appendAll).toHaveBeenCalledTimes(1)
    const [, events] = appendAll.mock.calls[0] ?? []
    expect(events).toEqual([{ type: 'OrderPickedUpEvent', orderId: order.id, handoverOtpId: 'otp-id-1', at: NOW }])
  })
})

describe('CompletePickingUseCase — precondition (а) SRS-PHT-026 п.1', () => {
  it('позиция ещё pending → 422 BUSINESS_RULE_VIOLATION с unresolvedItemIds', async () => {
    const { useCase, orderRepo } = makeHarness()
    const order = makeOrder(['scanned_ok', 'pending'])
    orderRepo.seed(order)

    const error = await useCase.execute(cmd(order.id)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BusinessRuleViolationError)
    expect((error as BusinessRuleViolationError).details).toEqual({ unresolvedItemIds: [order.items[1]?.id] })
  })
})

describe('CompletePickingUseCase — precondition (б) SRS-PHT-026 п.2 (TC-PHT-014)', () => {
  it('unavailable-позиция БЕЗ order_partial_fulfillment_requests → 409 PARTIAL_FULFILLMENT_PENDING', async () => {
    const { useCase, orderRepo, findLatestByOrderId } = makeHarness()
    findLatestByOrderId.mockResolvedValue(null)
    const order = makeOrder(['scanned_ok', 'unavailable'])
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(PendingCustomerConfirmationError)
  })

  it('unavailable-позиция с request.status="awaiting_customer" (ещё не решено) → 409', async () => {
    const { useCase, orderRepo, findLatestByOrderId } = makeHarness()
    const order = makeOrder(['scanned_ok', 'unavailable'])
    findLatestByOrderId.mockResolvedValue(makeRequest(order.id, { status: 'awaiting_customer', respondedAt: null }))
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(PendingCustomerConfirmationError)
  })

  it.each(['confirmed', 'auto_confirmed_timeout'] as const)(
    'unavailable-позиция с request.status=%s → успех (сборка завершается)',
    async (status) => {
      const { useCase, orderRepo, findLatestByOrderId } = makeHarness()
      const order = makeOrder(['scanned_ok', 'unavailable'])
      findLatestByOrderId.mockResolvedValue(makeRequest(order.id, { status }))
      orderRepo.seed(order)

      const result = await useCase.execute(cmd(order.id))
      expect(result.status).toBe('picked_up')
    },
  )
})

describe('CompletePickingUseCase — precondition (в) SRS-PHT-026 п.3 (гонка партии)', () => {
  it('партия просрочена НА МОМЕНТ вызова (hasExpiredReservedBatch=true) → 422 EXPIRED_STOCK, не тихий проход', async () => {
    const { useCase, orderRepo, hasExpiredReservedBatch, otpGenerate } = makeHarness()
    hasExpiredReservedBatch.mockResolvedValue(true)
    const order = makeOrder(['scanned_ok', 'scanned_ok'])
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id))).rejects.toBeInstanceOf(ExpiredStockError)
    expect(otpGenerate).not.toHaveBeenCalled()
  })
})

describe('CompletePickingUseCase — RBAC/NotFound', () => {
  it('чужая аптека → ForbiddenError', async () => {
    const { useCase, orderRepo } = makeHarness()
    const order = makeOrder(['scanned_ok'])
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id, { actor: PHARMACIST_OTHER }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin — НЕ допущен (RBAC: pharmacist, own pharmacy — буквальный текст тикета)', async () => {
    const { useCase, orderRepo } = makeHarness()
    const order = makeOrder(['scanned_ok'])
    orderRepo.seed(order)

    await expect(useCase.execute(cmd(order.id, { actor: PHARMACY_ADMIN }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('заказ не найден → NotFoundError', async () => {
    const { useCase } = makeHarness()
    await expect(useCase.execute(cmd(randomUUID()))).rejects.toBeInstanceOf(NotFoundError)
  })
})
