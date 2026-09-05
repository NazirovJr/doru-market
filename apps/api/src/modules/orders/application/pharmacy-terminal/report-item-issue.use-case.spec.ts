/**
 * `ReportItemIssueUseCase` (DTJ-303, EP-12 §A.4, SRS-PHT-017/018) — три допустимых `reason`,
 * precondition-guard на `fulfillmentStatus`, `reconcileZeroStock` вызывается ТОЛЬКО при
 * `out_of_stock` (мок-проверка отсутствия вызова для двух других причин), и ТОЛЬКО ПОСЛЕ того,
 * как `unitOfWork.run(...)` уже вернул результат (DoD: «не внутри неё») — плюс отказ самого
 * `reconcileZeroStock` не должен ломать успешный ответ клиенту (fire-and-forget).
 */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { isOk } from '@dorutj/domain-kernel'
import { BusinessRuleViolationError, ForbiddenError, NotFoundError, type ReportItemIssueReason } from '@dorutj/contracts'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand, validOrderItemCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { InventoryFacadePort } from '@/modules/orders/application/ports/inventory-facade.port.js'
import { ReportItemIssueUseCase, type ReportItemIssueActor, type ReportItemIssueCommand } from './report-item-issue.use-case.js'

const PASSTHROUGH_UOW: OrdersUnitOfWorkPort = { run: (callback) => callback(undefined) }
const SILENT_LOGGER = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger

const MEDICINE_ID = randomUUID()
const ORIGINAL_BATCH_ID = randomUUID()
const PHARMACY_ID = 'pharmacy-1'
const TENANT_ID = 'tenant-1'

const PHARMACIST_OWN: ReportItemIssueActor = { userId: 'pharmacist-1', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }
const PHARMACIST_OTHER: ReportItemIssueActor = { userId: 'pharmacist-2', role: 'pharmacist', tenantId: TENANT_ID, pharmacyId: 'pharmacy-2' }
const PHARMACY_ADMIN: ReportItemIssueActor = { userId: 'admin-1', role: 'pharmacy_admin', tenantId: TENANT_ID, pharmacyId: PHARMACY_ID }

function makeOrder(overrides: Partial<OrderSnapshot> = {}): Order {
  const created = Order.create(
    validOrderCreateCommand({
      tenantId: TENANT_ID,
      pharmacyId: PHARMACY_ID,
      items: [validOrderItemCommand({ medicineId: MEDICINE_ID, inventoryBatchId: ORIGINAL_BATCH_ID, pharmacyId: PHARMACY_ID })],
    }),
  )
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Object.keys(overrides).length === 0 ? created.value : Order.restore({ ...created.value.toSnapshot(), ...overrides })
}

/** Позиция уже `scanned_ok`/`unavailable` — для проверки precondition-guard (SRS-PHT-017 п.2). */
function makeOrderWithItemStatus(status: OrderSnapshot['items'][number]['fulfillmentStatus']): Order {
  const base = makeOrder()
  const snapshot = base.toSnapshot()
  return Order.restore({
    ...snapshot,
    items: snapshot.items.map((item) => ({ ...item, fulfillmentStatus: status })),
  })
}

interface Harness {
  readonly useCase: ReportItemIssueUseCase
  readonly repo: InMemoryOrderRepository
  readonly reconcileZeroStock: ReturnType<typeof vi.fn>
}

function makeHarness(): Harness {
  const repo = new InMemoryOrderRepository()
  const reconcileZeroStock = vi.fn<InventoryFacadePort['reconcileZeroStock']>().mockResolvedValue(undefined)
  const inventoryFacade: InventoryFacadePort = {
    reserveStock: vi.fn(),
    releaseStock: vi.fn(),
    hasExpiredReservedBatch: vi.fn(),
    getStockQuantity: vi.fn(),
    reserveForOrder: vi.fn(),
    reconcileZeroStock,
  }
  const useCase = new ReportItemIssueUseCase(repo, PASSTHROUGH_UOW, inventoryFacade, SILENT_LOGGER)
  return { useCase, repo, reconcileZeroStock }
}

function baseCommand(order: Order, overrides: Partial<ReportItemIssueCommand> = {}): ReportItemIssueCommand {
  const item = order.items[0]
  if (!item) throw new Error('fixture: expected item')
  return {
    orderId: order.id,
    itemId: item.id,
    reason: 'out_of_stock',
    actor: PHARMACIST_OWN,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportItemIssueUseCase — успешный переход (SRS-PHT-017/018)', () => {
  it.each<ReportItemIssueReason>(['out_of_stock', 'expired_on_shelf', 'damaged_packaging'])(
    'reason=%s → 200, fulfillmentStatus=unavailable, itemIssueReason=reason',
    async (reason) => {
      const { useCase, repo } = makeHarness()
      const order = makeOrder()
      repo.seed(order)

      const dto = await useCase.execute(baseCommand(order, { reason }))

      expect(dto.fulfillmentStatus).toBe('unavailable')
      expect(dto.itemIssueReason).toBe(reason)
      const saved = await repo.findById(TENANT_ID, order.id)
      expect(saved?.items[0]?.fulfillmentStatus).toBe('unavailable')
      expect(saved?.items[0]?.itemIssueReason).toBe(reason)
    },
  )

  it('TC-PHT-008: reason=out_of_stock → reconcileZeroStock(medicineId, batchId зарезервированной партии) вызван', async () => {
    const { useCase, repo, reconcileZeroStock } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await useCase.execute(baseCommand(order, { reason: 'out_of_stock' }))
    await vi.waitFor(() => {
      expect(reconcileZeroStock).toHaveBeenCalledWith(MEDICINE_ID, ORIGINAL_BATCH_ID)
    })
  })

  it.each<ReportItemIssueReason>(['expired_on_shelf', 'damaged_packaging'])(
    'reason=%s → reconcileZeroStock НЕ вызван (только out_of_stock сигнализирует расхождение остатка)',
    async (reason) => {
      const { useCase, repo, reconcileZeroStock } = makeHarness()
      const order = makeOrder()
      repo.seed(order)

      await useCase.execute(baseCommand(order, { reason }))

      expect(reconcileZeroStock).not.toHaveBeenCalled()
    },
  )

  it('reconcileZeroStock вызван ПОСЛЕ того, как unitOfWork.run уже вернул результат (не внутри транзакции)', async () => {
    const repo = new InMemoryOrderRepository()
    const order = makeOrder()
    repo.seed(order)
    const callOrder: string[] = []
    const uow: OrdersUnitOfWorkPort = {
      run: async (callback) => {
        const result = await callback(undefined)
        callOrder.push('transaction_committed')
        return result
      },
    }
    const reconcileZeroStock = vi.fn<InventoryFacadePort['reconcileZeroStock']>().mockImplementation(() => {
      callOrder.push('reconcile_called')
      return Promise.resolve()
    })
    const inventoryFacade: InventoryFacadePort = {
      reserveStock: vi.fn(),
      releaseStock: vi.fn(),
      hasExpiredReservedBatch: vi.fn(),
      getStockQuantity: vi.fn(),
      reserveForOrder: vi.fn(),
      reconcileZeroStock,
    }
    const useCase = new ReportItemIssueUseCase(repo, uow, inventoryFacade, SILENT_LOGGER)

    await useCase.execute(baseCommand(order, { reason: 'out_of_stock' }))
    await vi.waitFor(() => {
      expect(callOrder).toEqual(['transaction_committed', 'reconcile_called'])
    })
  })

  it('reconcileZeroStock отклоняется (недоступен инвентарный лог) → execute() всё равно резолвится успешно (fire-and-forget, не блокирует ответ клиенту)', async () => {
    const { useCase, repo, reconcileZeroStock } = makeHarness()
    const order = makeOrder()
    repo.seed(order)
    reconcileZeroStock.mockRejectedValue(new Error('reconciliation log unavailable'))

    const dto = await useCase.execute(baseCommand(order, { reason: 'out_of_stock' }))

    expect(dto.fulfillmentStatus).toBe('unavailable')
  })
})

describe('ReportItemIssueUseCase — precondition-guard (SRS-PHT-017 п.2)', () => {
  it('позиция уже scanned_ok → 422 BusinessRuleViolationError, reconcileZeroStock НЕ вызывается', async () => {
    const { useCase, repo, reconcileZeroStock } = makeHarness()
    const order = makeOrderWithItemStatus('scanned_ok')
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order))).rejects.toBeInstanceOf(BusinessRuleViolationError)

    expect(reconcileZeroStock).not.toHaveBeenCalled()
    const saved = await repo.findById(TENANT_ID, order.id)
    expect(saved?.items[0]?.fulfillmentStatus).toBe('scanned_ok')
  })

  it('позиция уже unavailable → 422 BusinessRuleViolationError (нельзя пожаловаться дважды)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrderWithItemStatus('unavailable')
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order))).rejects.toBeInstanceOf(BusinessRuleViolationError)
  })
})

describe('ReportItemIssueUseCase — авторизация и существование (SRS-API-043/046)', () => {
  it('несуществующий заказ → 404 NotFoundError', async () => {
    const { useCase } = makeHarness()
    await expect(
      useCase.execute({ orderId: randomUUID(), itemId: randomUUID(), reason: 'out_of_stock', actor: PHARMACIST_OWN }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('чужой тенант → 404 NotFoundError (не 403 — существование не подтверждается)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { actor: { ...PHARMACIST_OWN, tenantId: 'tenant-2' } }))).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('pharmacist ДРУГОЙ аптеки → 403 ForbiddenError', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { actor: PHARMACIST_OTHER }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('pharmacy_admin (своя аптека) → 403 ForbiddenError (РОВНО pharmacist, тот же RBAC, что DTJ-302)', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { actor: PHARMACY_ADMIN }))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('неизвестный itemId → 404 NotFoundError', async () => {
    const { useCase, repo } = makeHarness()
    const order = makeOrder()
    repo.seed(order)

    await expect(useCase.execute(baseCommand(order, { itemId: randomUUID() }))).rejects.toBeInstanceOf(NotFoundError)
  })
})
