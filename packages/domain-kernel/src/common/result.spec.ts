import { describe, expect, it } from 'vitest'
import { err, isErr, isOk, ok } from './result.js'

describe('Result helpers', () => {
  it('ok wraps a value', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe(42)
    }
  })

  it('err wraps an error', () => {
    const r = err(new Error('boom'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toBe('boom')
    }
  })

  it('isOk narrows correctly', () => {
    const r = ok('x')
    if (isOk(r)) {
      const value: string = r.value
      expect(value).toBe('x')
    }
  })

  it('isErr narrows correctly', () => {
    const r = err('failure')
    if (isErr(r)) {
      const error: string = r.error
      expect(error).toBe('failure')
    }
  })
})
