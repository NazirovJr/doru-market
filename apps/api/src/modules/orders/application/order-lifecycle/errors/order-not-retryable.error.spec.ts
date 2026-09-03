import { describe, expect, it } from 'vitest'
import { ErrorCode } from '@dorutj/contracts'
import { OrderNotRetryableError } from './order-not-retryable.error.js'

describe('OrderNotRetryableError (DTJ-241)', () => {
  it('code — ORDER_NOT_RETRYABLE, details пробрасываются', () => {
    const error = new OrderNotRetryableError({ orderId: 'x', status: 'paid_escrow' })
    expect(error.code).toBe(ErrorCode.ORDER_NOT_RETRYABLE)
    expect(error.details).toEqual({ orderId: 'x', status: 'paid_escrow' })
  })
})
