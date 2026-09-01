import { BadRequestException } from '@nestjs/common'
import { ErrorCode } from '@dorutj/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CursorQueryPipe } from './cursor-query.pipe.js'

describe('CursorQueryPipe (DTJ-018, SRS-API-004/005/006/007)', () => {
  const sortEnum = z.enum(['created_at', 'updated_at'] as const)

  it('1. валидный пустой query → defaults (limit=20, sort=created_at, cursor=null)', () => {
    const pipe = new CursorQueryPipe(sortEnum, 'date')
    const result = pipe.transform({}, {} as never)
    expect(result).toEqual({ cursor: null, limit: 20, sort: 'created_at', filter: {} })
  })

  it('2. валидный cursor (date ISO) → decoded', () => {
    const pipe = new CursorQueryPipe(sortEnum, 'date')
    const cursor = Buffer.from(JSON.stringify({ v: '2026-08-27' })).toString('base64url')
    const result = pipe.transform({ cursor, limit: '50' }, {} as never)
    expect(result.cursor).toEqual({ v: '2026-08-27' })
    expect(result.limit).toBe(50)
  })

  it('3. cursor с числом для date-эндпоинта → INVALID_CURSOR', () => {
    const pipe = new CursorQueryPipe(sortEnum, 'date')
    const cursor = Buffer.from(JSON.stringify({ v: 123 })).toString('base64url')
    let caught: unknown
    try {
      pipe.transform({ cursor }, {} as never)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    // `CursorQueryPipe` кидает `BadRequestException(new InvalidCursorError(...))` —
    // `getResponse()` возвращает саму ошибку `DomainError` (не завёрнутую в
    // `{ error: {...} }`): `code`/`message`/`details` — прямые поля инстанса.
    // `AllExceptionsFilter` на HTTP-границе форматирует это в `{ error: {...} }`
    // сам (см. `extractErrorCode`), но здесь тестируется пайп в изоляции.
    const body = (caught as BadRequestException).getResponse()
    expect((body as { code: string }).code).toBe(ErrorCode.INVALID_CURSOR)
  })

  it('4. sort вне enum → VALIDATION_ERROR', () => {
    const pipe = new CursorQueryPipe(sortEnum, 'date')
    let caught: unknown
    try {
      pipe.transform({ sort: 'unknown' }, {} as never)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const body = (caught as BadRequestException).getResponse()
    expect((body as { code: string; details: { field: string } }).code).toBe(ErrorCode.VALIDATION_ERROR)
    expect((body as { code: string; details: { field: string } }).details.field).toBe('sort')
  })

  it('5. limit > 100 → VALIDATION_ERROR', () => {
    const pipe = new CursorQueryPipe(sortEnum, 'date')
    let caught: unknown
    try {
      pipe.transform({ limit: '200' }, {} as never)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
  })

  it('6. malformed base64 cursor → INVALID_CURSOR', () => {
    const pipe = new CursorQueryPipe(sortEnum, 'date')
    let caught: unknown
    try {
      pipe.transform({ cursor: 'not-base64-!!!' }, {} as never)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const body = (caught as BadRequestException).getResponse()
    expect((body as { code: string }).code).toBe(ErrorCode.INVALID_CURSOR)
  })

  it('7. cursor.v: number для number-эндпоинта → ok', () => {
    const pipe = new CursorQueryPipe(sortEnum, 'number')
    const cursor = Buffer.from(JSON.stringify({ v: 42 })).toString('base64url')
    const result = pipe.transform({ cursor }, {} as never)
    expect(result.cursor).toEqual({ v: 42 })
  })
})
