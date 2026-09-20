import { describe, expect, it, vi } from 'vitest'
import type {
  ReportPickingSlaBreachUseCase,
} from '@/modules/orders/application/pharmacy-terminal/report-picking-sla-breach.use-case.js'
import { PickingSlaBreachController } from './picking-sla-breach.controller.js'

function fakeUseCase(execute: ReturnType<typeof vi.fn>): ReportPickingSlaBreachUseCase {
  return { execute } as unknown as ReportPickingSlaBreachUseCase
}

describe('PickingSlaBreachController (DTJ-307)', () => {
  it('should call use case with correct parameters', async () => {
    const execute = vi.fn<ReportPickingSlaBreachUseCase['execute']>().mockResolvedValue({ orderId: 'order-1', status: 'published' })
    const controller = new PickingSlaBreachController(fakeUseCase(execute))
    
    const result = await controller.report('order-1', { tenantId: 'tenant-1' })
    
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'order-1' })
    expect(result).toEqual({ data: { orderId: 'order-1', status: 'published' } })
  })

  it('should pass through skipped results', async () => {
    const execute = vi.fn<ReportPickingSlaBreachUseCase['execute']>().mockResolvedValue({ orderId: 'order-1', status: 'skipped' })
    const controller = new PickingSlaBreachController(fakeUseCase(execute))
    
    const result = await controller.report('order-1', { tenantId: 'tenant-1' })
    
    expect(execute).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'order-1' })
    expect(result).toEqual({ data: { orderId: 'order-1', status: 'skipped' } })
  })
})