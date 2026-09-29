import { describe, expect, it, vi } from 'vitest'
import type { PharmacyOrdersCancellation } from '@/modules/orders/index.js'
import { OrdersCancellationAdapter } from './orders-cancellation.adapter.js'

function makeAdapter(result: { cancelledOrderIds: string[]; failedOrderIds: string[] }): OrdersCancellationAdapter {
  const orders = { execute: vi.fn().mockResolvedValue(result) } as unknown as PharmacyOrdersCancellation
  return new OrdersCancellationAdapter(orders)
}

describe('OrdersCancellationAdapter', () => {
  it('возвращает идентификаторы отменённых заказов', async () => {
    const adapter = makeAdapter({ cancelledOrderIds: ['o1', 'o2'], failedOrderIds: [] })

    expect(await adapter.forceCancelIncomplete('pharmacy-1', 'fraud')).toEqual({ cancelledOrderIds: ['o1', 'o2'] })
  })

  it('есть неотменённые заказы -> бросает, чтобы оператор повторил действие', async () => {
    const adapter = makeAdapter({ cancelledOrderIds: ['o1'], failedOrderIds: ['o2'] })

    await expect(adapter.forceCancelIncomplete('pharmacy-1', 'fraud')).rejects.toThrow(/o2/)
  })
})
