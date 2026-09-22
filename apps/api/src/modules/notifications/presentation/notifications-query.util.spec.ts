/**
 * Unit-тест `notifications-query.util.ts` (DTJ-372).
 */
import { describe, expect, it } from 'vitest'
import { InvalidCursorError, ValidationError, encodeCursor } from '@dorutj/contracts'
import { parseListCursor, parseStatusFilter } from './notifications-query.util.js'

describe('parseListCursor', () => {
  it('мусор вместо курсора not-a-cursor → бросает InvalidCursorError', () => {
    expect(() => parseListCursor('not-a-cursor')).toThrow(InvalidCursorError)
  })

  it('encodeCursor({ v, id }) → { v, id }', () => {
    const cursor = { v: '2026-09-04T10:00:00.000Z', id: 'notification-1' }
    const encoded = encodeCursor(cursor)
    expect(parseListCursor(encoded)).toEqual(cursor)
  })
})

describe('parseStatusFilter', () => {
  it('queued,sent → [queued, sent]', () => {
    expect(parseStatusFilter('queued,sent')).toEqual(['queued', 'sent'])
  })

  it(' queued , ,sent  → то же', () => {
    expect(parseStatusFilter(' queued , ,sent ')).toEqual(['queued', 'sent'])
  })

  it('undefined → undefined', () => {
    expect(parseStatusFilter(undefined)).toBeUndefined()
  })

  it('неизвестный статус deleted → бросает ValidationError', () => {
    expect(() => parseStatusFilter('deleted')).toThrow(ValidationError)
  })
})
