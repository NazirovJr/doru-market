import { describe, expect, it } from 'vitest'
import { InvalidCursorError, ValidationError, encodeCursor } from '@dorutj/contracts'
import { parseListQuery, parseStatusesFilter } from './pharmacy-accounts-report-query.util.js'

describe('parseListQuery (DTJ-252)', () => {
  it('без параметров — дефолт limit=20, cursor=null', () => {
    expect(parseListQuery(undefined, undefined)).toEqual({ limit: 20, cursor: null })
  })

  it('валидный cursor — декодируется в { v, id }', () => {
    const raw = encodeCursor({ v: '2026-09-04T00:00:00.000Z', id: 'payout-1' })
    expect(parseListQuery('10', raw)).toEqual({ limit: 10, cursor: { v: '2026-09-04T00:00:00.000Z', id: 'payout-1' } })
  })

  it('limit > 100 → ValidationError', () => {
    expect(() => parseListQuery('101', undefined)).toThrow(ValidationError)
  })

  it('limit=0 → ValidationError (min 1)', () => {
    expect(() => parseListQuery('0', undefined)).toThrow(ValidationError)
  })

  it('нерасшифровываемый cursor (не base64url/JSON) → InvalidCursorError', () => {
    expect(() => parseListQuery(undefined, 'not-a-valid-cursor-!!!')).toThrow(InvalidCursorError)
  })

  it('cursor с v не строкой → InvalidCursorError (v ожидается ISO-строкой created_at)', () => {
    const raw = encodeCursor({ v: 12345, id: 'payout-1' })
    expect(() => parseListQuery(undefined, raw)).toThrow(InvalidCursorError)
  })
})

describe('parseStatusesFilter (DTJ-252)', () => {
  it('undefined → undefined (без фильтра)', () => {
    expect(parseStatusesFilter(undefined)).toBeUndefined()
  })

  it('пустая строка → undefined', () => {
    expect(parseStatusesFilter('')).toBeUndefined()
  })

  it('"due,paid" → ["due", "paid"]', () => {
    expect(parseStatusesFilter('due,paid')).toEqual(['due', 'paid'])
  })

  it('с пробелами вокруг запятой — обрезаются', () => {
    expect(parseStatusesFilter(' due , paid ')).toEqual(['due', 'paid'])
  })
})
