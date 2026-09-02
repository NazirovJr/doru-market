/**
 * Тест `ResponseInterceptor` (EP-01, DTJ-018, SRS-API-014/015): оборачивание
 * произвольного возвращаемого значения в `{ data }`, пропуск уже готового
 * `SuccessEnvelope` (`ok(...)`) без повторного оборачивания, поведение на
 * ответе без тела (`undefined`/`null`).
 */
import { type CallHandler, type ExecutionContext } from '@nestjs/common'
import { ok } from '@dorutj/contracts'
import { firstValueFrom, of } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { ResponseInterceptor } from './response.interceptor.js'

/** `CallHandler`-заглушка: интерсептор читает только `handle()`. */
function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) }
}

describe('ResponseInterceptor (DTJ-018, SRS-API-014/015)', () => {
  const interceptor = new ResponseInterceptor()
  const ctx = {} as ExecutionContext

  it('1. произвольный объект контроллера → оборачивается в { data: <value> }', async () => {
    const value = { id: '1', name: 'Аспирин' }
    const result = await firstValueFrom(interceptor.intercept(ctx, handlerReturning(value)))
    expect(result).toEqual({ data: value })
  })

  it('2. массив → тоже оборачивается в { data: [...] }, не разворачивается по элементам', async () => {
    const value = [1, 2, 3]
    const result = await firstValueFrom(interceptor.intercept(ctx, handlerReturning(value)))
    expect(result).toEqual({ data: [1, 2, 3] })
  })

  it('3. уже готовый SuccessEnvelope (ok(...) с meta) → возвращается без повторного оборачивания', async () => {
    const envelope = ok([{ id: '1' }], { pagination: { nextCursor: null, hasMore: false, limit: 20 } })
    const result = await firstValueFrom(interceptor.intercept(ctx, handlerReturning(envelope)))
    expect(result).toBe(envelope)
    expect(result).not.toHaveProperty('data.data')
  })

  it('4. ответ без тела (undefined) → { data: undefined }, а не падение интерсептора', async () => {
    const result = await firstValueFrom(interceptor.intercept(ctx, handlerReturning(undefined)))
    expect(result).toEqual({ data: undefined })
  })

  it('5. ответ null → { data: null } (null — не SuccessEnvelope, isSuccessEnvelope на нём false)', async () => {
    const result = await firstValueFrom(interceptor.intercept(ctx, handlerReturning(null)))
    expect(result).toEqual({ data: null })
  })

  it('6. объект с полем data, но без error (похож на конверт) → распознаётся как SuccessEnvelope и не оборачивается повторно', async () => {
    const looksLikeEnvelope = { data: 'raw-value' }
    const result = await firstValueFrom(interceptor.intercept(ctx, handlerReturning(looksLikeEnvelope)))
    expect(result).toBe(looksLikeEnvelope)
  })
})
