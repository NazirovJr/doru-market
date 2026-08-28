import { describe, expect, it } from 'vitest'
import { ErrorCode } from './errors'
import { fail, ok } from './envelope'

describe('ok', () => {
  it('без meta даёт { data }', () => {
    expect(ok({ id: '1' })).toEqual({ data: { id: '1' } })
  })

  it('с meta даёт { data, meta }', () => {
    const meta = { pagination: { nextCursor: null, hasMore: false, limit: 20 } }
    expect(ok([{ id: '1' }], meta)).toEqual({ data: [{ id: '1' }], meta })
  })
})

describe('fail', () => {
  it('без details даёт { error: { code, message } }', () => {
    expect(fail(ErrorCode.NOT_FOUND, 'Resource not found')).toEqual({
      error: { code: ErrorCode.NOT_FOUND, message: 'Resource not found' },
    })
  })

  it('с details даёт { error: { code, message, details } }', () => {
    const details = { field: 'phone' }
    expect(fail(ErrorCode.VALIDATION_ERROR, 'Invalid', details)).toEqual({
      error: { code: ErrorCode.VALIDATION_ERROR, message: 'Invalid', details },
    })
  })
})
