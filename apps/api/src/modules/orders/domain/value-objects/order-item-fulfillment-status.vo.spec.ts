import { describe, expect, it } from 'vitest'
import {
  ORDER_ITEM_FULFILLMENT_STATUS_VALUES,
  isOrderItemFulfillmentStatus,
} from './order-item-fulfillment-status.vo.js'

describe('ORDER_ITEM_FULFILLMENT_STATUS_VALUES (DTJ-300, SRS-PHT-002)', () => {
  it('содержит ровно 3 канонических значения в порядке DDL (order_item_fulfillment_status)', () => {
    expect(ORDER_ITEM_FULFILLMENT_STATUS_VALUES).toEqual(['pending', 'scanned_ok', 'unavailable'])
  })
})

describe('isOrderItemFulfillmentStatus (гард VO)', () => {
  it.each(ORDER_ITEM_FULFILLMENT_STATUS_VALUES)('%s — валидное значение проходит', (value) => {
    expect(isOrderItemFulfillmentStatus(value)).toBe(true)
  })

  it.each(['PENDING', 'scanned', 'in_progress', '', 'unavailable ', 'null'])(
    '%j — невалидное значение отклоняется',
    (value) => {
      expect(isOrderItemFulfillmentStatus(value)).toBe(false)
    },
  )
})
