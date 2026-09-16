/**
 * `PartialFulfillmentTimeoutController` (EP-12, DTJ-304) — тонкий маппер тела запроса → команда
 * use case (тот же приём, что `system-cancel-order.controller.spec.ts`). Guard тестируется
 * отдельно (`internal-service.guard.spec.ts`).
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  ResolvePartialFulfillmentResult,
  ResolvePartialFulfillmentUseCase,
} from '@/modules/orders/application/pharmacy-terminal/resolve-partial-fulfillment.use-case.js'
import { PartialFulfillmentTimeoutController } from './partial-fulfillment-timeout.controller.js'

function fakeUseCase(execute: ReturnType<typeof vi.fn>): ResolvePartialFulfillmentUseCase {
  return { execute } as unknown as ResolvePartialFulfillmentUseCase
}

describe('PartialFulfillmentTimeoutController (DTJ-304)', () => {
  it('маппит requestId (path) + tenantId (body) в confirmed=true/source=timeout', async () => {
    const result: ResolvePartialFulfillmentResult = { requestId: 'req-1', orderId: 'order-1', status: 'auto_confirmed_timeout' }
    const execute = vi.fn().mockResolvedValue(result)
    const controller = new PartialFulfillmentTimeoutController(fakeUseCase(execute))

    const response = await controller.resolveTimeout('req-1', { tenantId: 'tenant-1' })

    expect(execute).toHaveBeenCalledExactlyOnceWith({
      requestId: 'req-1',
      tenantId: 'tenant-1',
      confirmed: true,
      source: 'timeout',
    })
    expect(response).toEqual({ data: result })
  })

  it('пробрасывает результат use case как есть (status: confirmed — гонка, клиент уже ответил)', async () => {
    const result: ResolvePartialFulfillmentResult = { requestId: 'req-2', orderId: 'order-2', status: 'confirmed' }
    const execute = vi.fn().mockResolvedValue(result)
    const controller = new PartialFulfillmentTimeoutController(fakeUseCase(execute))

    const response = await controller.resolveTimeout('req-2', { tenantId: 'tenant-1' })

    expect(response.data).toEqual(result)
  })
})
