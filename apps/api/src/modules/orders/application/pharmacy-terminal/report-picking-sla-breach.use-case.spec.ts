import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { NotFoundError } from '@dorutj/contracts'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { Order, type OrderSnapshot } from '@/modules/orders/domain/order.entity.js'
import type { OrdersUnitOfWorkPort } from '@/modules/orders/application/ports/unit-of-work.port.js'
import type { OrdersOutboxPort } from '@/modules/orders/application/ports/orders-outbox.port.js'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { ReportPickingSlaBreachUseCase } from './report-picking-sla-breach.use-case.js'

const NOW = new Date('2026-09-05T12:07:01.000Z')
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

function orderAtStatus(status: OrderSnapshot['status']): Order {
  const paymentMethod = status === 'confirmed' ? 'cash_courier' : 'alif_mobi'
  const created = Order.create(validOrderCreateCommand({ tenantId: TENANT_ID, pharmacyId: PHARMACY_ID, paymentMethod }))
  if (!isOk(created)) throw new Error('fixture: expected Ok')
  return Order.restore({ ...created.value.toSnapshot(), status })
}

function makeHarness(pickupSlaMinutes = 7) {
  const repo = new InMemoryOrderRepository()
  const appendAll = vi.fn<OrdersOutboxPort['appendAll']>().mockResolvedValue(undefined)
  const getPickupSlaMinutes = vi.fn<TenancyFacadePort['getPickupSlaMinutes']>().mockResolvedValue(pickupSlaMinutes)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes,
    getPickupSlaBufferMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
    getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
    getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
  }
  const useCase = new ReportPickingSlaBreachUseCase(repo, new PassthroughUnitOfWork(), { appendAll }, tenancyFacade, new FixedClock())
  return { useCase, repo, appendAll, getPickupSlaMinutes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportPickingSlaBreachUseCase (DTJ-307, TC-PHT-021)', () => {
  it('should publish SlaBreachedEvent for processing orders', async () => {
    const { useCase, repo, appendAll } = makeHarness()
    
    const order = orderAtStatus('processing')
    repo.seed(order)
    
    const result = await useCase.execute({ tenantId: TENANT_ID, orderId: order.id })
    
    expect(result).toEqual({ orderId: order.id, status: 'published' })
    expect(appendAll).toHaveBeenCalledWith(TENANT_ID, [
      {
        type: 'SlaBreachedEvent',
        orderId: order.id,
        entityType: 'pharmacy_order',
        entityId: order.id,
        breachedAt: NOW,
        slaMinutes: 7,
      }
    ], undefined)
  })

  it('should use pickup SLA minutes from tenancy facade', async () => {
    const { useCase, repo, appendAll } = makeHarness(10)
    
    const order = orderAtStatus('processing')
    repo.seed(order)
    
    const result = await useCase.execute({ tenantId: TENANT_ID, orderId: order.id })
    
    expect(result).toEqual({ orderId: order.id, status: 'published' })
    expect(appendAll).toHaveBeenCalledWith(TENANT_ID, [
      {
        type: 'SlaBreachedEvent',
        orderId: order.id,
        entityType: 'pharmacy_order',
        entityId: order.id,
        breachedAt: NOW,
        slaMinutes: 10,
      }
    ], undefined)
  })

  it('should skip publishing for picked_up orders', async () => {
    const { useCase, repo, appendAll } = makeHarness()
    
    const order = orderAtStatus('picked_up')
    repo.seed(order)
    
    const result = await useCase.execute({ tenantId: TENANT_ID, orderId: order.id })
    
    expect(result).toEqual({ orderId: order.id, status: 'skipped' })
    expect(appendAll).not.toHaveBeenCalled()
  })

  it('should skip publishing for cancelled orders', async () => {
    const { useCase, repo, appendAll } = makeHarness()
    
    const order = orderAtStatus('cancelled')
    repo.seed(order)
    
    const result = await useCase.execute({ tenantId: TENANT_ID, orderId: order.id })
    
    expect(result).toEqual({ orderId: order.id, status: 'skipped' })
    expect(appendAll).not.toHaveBeenCalled()
  })

  it('should skip publishing for paid_escrow orders', async () => {
    const { useCase, repo, appendAll } = makeHarness()
    
    const order = orderAtStatus('paid_escrow')
    repo.seed(order)
    
    const result = await useCase.execute({ tenantId: TENANT_ID, orderId: order.id })
    
    expect(result).toEqual({ orderId: order.id, status: 'skipped' })
    expect(appendAll).not.toHaveBeenCalled()
  })

  it('should throw NotFoundError for non-existent orders', async () => {
    const { useCase } = makeHarness()
    
    await expect(useCase.execute({ tenantId: TENANT_ID, orderId: 'non-existent' }))
      .rejects
      .toMatchObject(new NotFoundError({ resource: 'order', orderId: 'non-existent' }))
  })
})