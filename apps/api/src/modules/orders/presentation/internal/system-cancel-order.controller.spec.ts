/**
 * `SystemCancelOrderController` (EP-10, DTJ-253/254) — тонкий маппер тела запроса → команда
 * use case. Guard тестируется отдельно (`internal-service.guard.spec.ts`); здесь проверяем
 * ТОЛЬКО делегирование и форму ответа (тот же приём, что `get-order-ledger.controller.ts`,
 * если бы у него был unit-спек — presentation-слой без бизнес-логики).
 */
import { describe, expect, it, vi } from 'vitest'
import type { SystemCancelOrderUseCase, SystemCancelOrderResult } from '@/modules/orders/application/order-lifecycle/system-cancel-order.use-case.js'
import { SystemCancelOrderController } from './system-cancel-order.controller.js'

function fakeUseCase(execute: ReturnType<typeof vi.fn>): SystemCancelOrderUseCase {
  return { execute } as unknown as SystemCancelOrderUseCase
}

describe('SystemCancelOrderController (DTJ-253/254)', () => {
  it('маппит orderId (path) + tenantId/expectedFromStatus/reason (body) в команду use case', async () => {
    const result: SystemCancelOrderResult = { orderId: 'order-1', status: 'cancelled', refundIssued: false }
    const execute = vi.fn().mockResolvedValue(result)
    const controller = new SystemCancelOrderController(fakeUseCase(execute))

    const response = await controller.systemCancel('order-1', {
      tenantId: 'tenant-1',
      expectedFromStatus: 'pending_payment',
      reason: 'payment_timeout',
    })

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      expectedFromStatus: 'pending_payment',
      reason: 'payment_timeout',
    })
    expect(response).toEqual({ data: result })
  })

  it('пробрасывает результат use case как есть (status: skipped)', async () => {
    const result: SystemCancelOrderResult = { orderId: 'order-2', status: 'skipped', refundIssued: false }
    const execute = vi.fn().mockResolvedValue(result)
    const controller = new SystemCancelOrderController(fakeUseCase(execute))

    const response = await controller.systemCancel('order-2', {
      tenantId: 'tenant-1',
      expectedFromStatus: 'paid_escrow',
      reason: 'pickup_sla_timeout',
    })

    expect(response.data).toEqual(result)
  })

  it('пропускает expectedFromStatus: processing (DTJ-307, мягкое нарушение SLA сборки)', async () => {
    const result: SystemCancelOrderResult = { orderId: 'order-3', status: 'cancelled', refundIssued: true }
    const execute = vi.fn().mockResolvedValue(result)
    const controller = new SystemCancelOrderController(fakeUseCase(execute))

    const response = await controller.systemCancel('order-3', {
      tenantId: 'tenant-1',
      expectedFromStatus: 'processing',
      reason: 'pickup_sla_timeout',
    })

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      tenantId: 'tenant-1',
      orderId: 'order-3',
      expectedFromStatus: 'processing',
      reason: 'pickup_sla_timeout',
    })
    expect(response).toEqual({ data: result })
  })
})
