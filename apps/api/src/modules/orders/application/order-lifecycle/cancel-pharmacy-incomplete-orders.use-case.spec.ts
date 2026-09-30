import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { OrderStatus } from '@dorutj/contracts'
import type { OrdersFacade } from '@/modules/orders/application/orders.facade.js'
import type { SystemCancelOrderUseCase } from './system-cancel-order.use-case.js'
import { CancelPharmacyIncompleteOrdersUseCase } from './cancel-pharmacy-incomplete-orders.use-case.js'

const PHARMACY_ID = 'pharmacy-1'
const TENANT_ID = 'tenant-1'

interface OrderRef {
  readonly id: string
  readonly status: OrderStatus
}

function makeUseCase(ordersByStatus: Partial<Record<OrderStatus, readonly OrderRef[]>>, cancel: ReturnType<typeof vi.fn>) {
  const findOrdersAny = vi.fn((filter: { status: OrderStatus }) => {
    const items = (ordersByStatus[filter.status] ?? []).map((o) => ({ id: o.id, tenantId: TENANT_ID, status: o.status }))
    return Promise.resolve({ items, nextCursor: null, hasMore: false })
  })
  const logger = { error: vi.fn() } as unknown as Logger
  const useCase = new CancelPharmacyIncompleteOrdersUseCase(
    { findOrdersAny } as unknown as OrdersFacade,
    { execute: cancel } as unknown as SystemCancelOrderUseCase,
    logger,
  )
  return { useCase, findOrdersAny }
}

describe('CancelPharmacyIncompleteOrdersUseCase', () => {
  it('отменяет заказы всех незавершённых статусов системной отменой с причиной pharmacy_suspended', async () => {
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' })
    const { useCase, findOrdersAny } = makeUseCase(
      {
        pending_payment: [{ id: 'o1', status: 'pending_payment' }],
        paid_escrow: [{ id: 'o2', status: 'paid_escrow' }],
        processing: [{ id: 'o3', status: 'processing' }],
      },
      cancel,
    )

    const result = await useCase.execute(PHARMACY_ID)

    expect(result).toEqual({ cancelledOrderIds: ['o1', 'o2', 'o3'], failedOrderIds: [] })
    expect(findOrdersAny.mock.calls.map(([filter]) => filter.status)).toEqual(['pending_payment', 'confirmed', 'paid_escrow', 'processing'])
    expect(cancel).toHaveBeenCalledWith({ tenantId: TENANT_ID, orderId: 'o2', expectedFromStatus: 'paid_escrow', reason: 'pharmacy_suspended' })
  })

  it('заказ, сменивший статус (skipped), не попадает в отменённые', async () => {
    const cancel = vi.fn().mockResolvedValue({ status: 'skipped' })
    const { useCase } = makeUseCase({ confirmed: [{ id: 'o1', status: 'confirmed' }] }, cancel)

    expect(await useCase.execute(PHARMACY_ID)).toEqual({ cancelledOrderIds: [], failedOrderIds: [] })
  })

  it('сбой одного заказа не останавливает остальные и попадает в failedOrderIds', async () => {
    const cancel = vi.fn().mockRejectedValueOnce(new Error('refund provider down')).mockResolvedValue({ status: 'cancelled' })
    const { useCase } = makeUseCase(
      { paid_escrow: [{ id: 'o1', status: 'paid_escrow' }, { id: 'o2', status: 'paid_escrow' }] },
      cancel,
    )

    expect(await useCase.execute(PHARMACY_ID)).toEqual({ cancelledOrderIds: ['o2'], failedOrderIds: ['o1'] })
  })

  it('scope=unpaid: ищет только pending_payment и confirmed, оплаченные не трогает', async () => {
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' })
    const { useCase, findOrdersAny } = makeUseCase(
      { pending_payment: [{ id: 'o1', status: 'pending_payment' }], paid_escrow: [{ id: 'o2', status: 'paid_escrow' }] },
      cancel,
    )

    const result = await useCase.execute(PHARMACY_ID, 'unpaid')

    expect(result.cancelledOrderIds).toEqual(['o1'])
    expect(findOrdersAny.mock.calls.map(([filter]) => filter.status)).toEqual(['pending_payment', 'confirmed'])
  })

  it('нет незавершённых заказов -> ничего не отменяется', async () => {
    const cancel = vi.fn()
    const { useCase } = makeUseCase({}, cancel)

    expect(await useCase.execute(PHARMACY_ID)).toEqual({ cancelledOrderIds: [], failedOrderIds: [] })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('обходит все страницы выдачи по курсору', async () => {
    const cancel = vi.fn().mockResolvedValue({ status: 'cancelled' })
    const findOrdersAny = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'o1', tenantId: TENANT_ID, status: 'confirmed' }], nextCursor: { v: 'x', id: 'o1' }, hasMore: true })
      .mockResolvedValueOnce({ items: [{ id: 'o2', tenantId: TENANT_ID, status: 'confirmed' }], nextCursor: null, hasMore: false })
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
    const useCase = new CancelPharmacyIncompleteOrdersUseCase(
      { findOrdersAny } as unknown as OrdersFacade,
      { execute: cancel } as unknown as SystemCancelOrderUseCase,
      { error: vi.fn() } as unknown as Logger,
    )

    expect((await useCase.execute(PHARMACY_ID)).cancelledOrderIds).toEqual(['o1', 'o2'])
  })
})
