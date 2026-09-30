import { describe, expect, it, vi } from 'vitest'
import type { PharmacyOrdersCancellation } from '@/modules/orders/index.js'
import { OrdersCancellationAdapter } from './orders-cancellation.adapter.js'

function makeAdapter(result: { cancelledOrderIds: string[]; failedOrderIds: string[] }) {
  const execute = vi.fn().mockResolvedValue(result)
  return { adapter: new OrdersCancellationAdapter({ execute } as unknown as PharmacyOrdersCancellation), execute }
}

describe('OrdersCancellationAdapter', () => {
  it('forceCancelIncomplete: отменяет все незавершённые заказы и возвращает идентификаторы', async () => {
    const { adapter, execute } = makeAdapter({ cancelledOrderIds: ['o1', 'o2'], failedOrderIds: [] })

    expect(await adapter.forceCancelIncomplete('pharmacy-1', 'fraud')).toEqual({ cancelledOrderIds: ['o1', 'o2'] })
    expect(execute).toHaveBeenCalledWith('pharmacy-1', 'all')
  })

  it('cancelUnpaid: отменяет только заказы без оплаты', async () => {
    const { adapter, execute } = makeAdapter({ cancelledOrderIds: ['o1'], failedOrderIds: [] })

    expect(await adapter.cancelUnpaid('pharmacy-1')).toEqual({ cancelledOrderIds: ['o1'] })
    expect(execute).toHaveBeenCalledWith('pharmacy-1', 'unpaid')
  })

  it('есть неотменённые заказы -> бросает, чтобы оператор повторил действие', async () => {
    const { adapter } = makeAdapter({ cancelledOrderIds: ['o1'], failedOrderIds: ['o2'] })

    await expect(adapter.forceCancelIncomplete('pharmacy-1', 'fraud')).rejects.toThrow(/o2/)
    await expect(adapter.cancelUnpaid('pharmacy-1')).rejects.toThrow(/o2/)
  })
})
