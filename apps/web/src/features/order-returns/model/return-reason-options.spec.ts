import { describe, expect, it } from 'vitest'
import { ORDER_STATUS_VALUES, RETURN_REASON_VALUES, type OrderStatus } from '@dorutj/contracts'
import { getAvailableReturnReasons } from './return-reason-options'

/**
 * `return-reason-options.spec.ts` (DTJ-276, тест-план: «все комбинации входного статуса заказа →
 * ожидаемый список причин»).
 */
describe('getAvailableReturnReasons (DTJ-276)', () => {
  it('delivered — все причины, кроме undelivered', () => {
    const result = getAvailableReturnReasons('delivered')
    expect(result).toEqual(RETURN_REASON_VALUES.filter((reason) => reason !== 'undelivered'))
    expect(result).not.toContain('undelivered')
    expect(result).toHaveLength(RETURN_REASON_VALUES.length - 1)
  })

  const nonDeliveredStatuses = ORDER_STATUS_VALUES.filter((status) => status !== 'delivered')

  it.each(nonDeliveredStatuses)(
    '%s — пустой список (недоступно клиенту напрямую, включая picked_up — ветка курьера/диспетчера)',
    (status: OrderStatus) => {
      expect(getAvailableReturnReasons(status)).toEqual([])
    },
  )
})
