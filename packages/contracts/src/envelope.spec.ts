import { describe, expect, it } from 'vitest'
import { ErrorCode } from './errors.js'
import { fail, isSuccessEnvelope, ok } from './envelope.js'

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

describe('isSuccessEnvelope', () => {
  it('{ data } без error — true', () => {
    expect(isSuccessEnvelope({ data: { id: '1' } })).toBe(true)
  })

  it('{ data, meta } — true (наличие meta не мешает)', () => {
    expect(isSuccessEnvelope(ok({ id: '1' }, { pagination: { nextCursor: null, hasMore: false, limit: 20 } }))).toBe(
      true,
    )
  })

  it('{ error } без data — false', () => {
    expect(isSuccessEnvelope(fail(ErrorCode.NOT_FOUND, 'Resource not found'))).toBe(false)
  })

  it('объект и с data, и с error одновременно — false (не должен считаться успехом)', () => {
    expect(isSuccessEnvelope({ data: {}, error: { code: ErrorCode.NOT_FOUND, message: 'x' } })).toBe(false)
  })

  it('объект без поля data — false', () => {
    expect(isSuccessEnvelope({ meta: {} })).toBe(false)
  })

  it('null — false (typeof null === "object", но явно исключён)', () => {
    expect(isSuccessEnvelope(null)).toBe(false)
  })

  it('примитив (не объект) — false', () => {
    expect(isSuccessEnvelope('data')).toBe(false)
    expect(isSuccessEnvelope(42)).toBe(false)
    expect(isSuccessEnvelope(undefined)).toBe(false)
  })
})
