import { describe, expect, it } from 'vitest'
import { cursorQuerySchema, decodeCursor, encodeCursor, isValidCursorShape } from './pagination.js'

describe('encodeCursor / decodeCursor', () => {
  it('round-trip: decodeCursor(encodeCursor(x)) равен x', () => {
    const payload = { v: '2026-08-27T00:00:00.000Z', id: 'uuid-123' }
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload)
  })

  it('невалидный base64/JSON → null, без исключения', () => {
    expect(decodeCursor('not-valid-base64!!!')).toBeNull()
  })

  it('валидный base64url, но не JSON → null', () => {
    const notJson = Buffer.from('not json at all', 'utf-8').toString('base64url')
    expect(decodeCursor(notJson)).toBeNull()
  })

  it('валидный JSON, но не форма курсора → null', () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf-8').toString('base64url')
    expect(decodeCursor(wrongShape)).toBeNull()
  })

  it('пустая строка → null', () => {
    expect(decodeCursor('')).toBeNull()
  })
})

describe('isValidCursorShape', () => {
  it('true для { v, id: string }', () => {
    expect(isValidCursorShape({ v: 42, id: 'x' })).toBe(true)
  })

  it('false для отсутствующего id / неверного типа id', () => {
    expect(isValidCursorShape({ v: 1 })).toBe(false)
    expect(isValidCursorShape({ v: 1, id: 42 })).toBe(false)
  })

  it('false для null/примитивов', () => {
    expect(isValidCursorShape(null)).toBe(false)
    expect(isValidCursorShape('string')).toBe(false)
    expect(isValidCursorShape(42)).toBe(false)
  })
})

describe('cursorQuerySchema', () => {
  it('limit по умолчанию 20, cursor опционален', () => {
    const parsed = cursorQuerySchema.parse({})
    expect(parsed).toEqual({ limit: 20 })
  })

  it('принимает limit в границах 1..100', () => {
    expect(cursorQuerySchema.parse({ limit: '1' }).limit).toBe(1)
    expect(cursorQuerySchema.parse({ limit: '100' }).limit).toBe(100)
  })

  it('отклоняет limit=101 (SRS-API-004: не молчаливое обрезание)', () => {
    expect(() => cursorQuerySchema.parse({ limit: '101' })).toThrow()
  })

  it('отклоняет limit=0', () => {
    expect(() => cursorQuerySchema.parse({ limit: '0' })).toThrow()
  })
})
