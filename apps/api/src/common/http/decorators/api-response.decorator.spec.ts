/**
 * Тест `@ApiSuccessResponse(meta)` (DTJ-018/DTJ-021): декоратор реально вешает
 * `meta` под ключом `API_SUCCESS_RESPONSE_KEY` на handler, читаемые ТЕМ ЖЕ
 * способом, каким это будет делать будущий OpenAPI-генератор DTJ-021 —
 * `Reflector.get(key, handler)` (стандартный паттерн Nest для
 * method-level `SetMetadata`, см. `@Idempotent()`/`IdempotencyInterceptor`).
 *
 * Декоратор применяется напрямую в форме, в которой его вызывает
 * TS-транспилятор для method-декоратора (target, propertyKey, descriptor) —
 * это позволяет проверить поведение `SetMetadata`, не заводя классы с
 * пустыми методами ради самого факта декорирования.
 */
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { ApiSuccessResponse, API_SUCCESS_RESPONSE_KEY, type ApiSuccessResponseMeta } from './api-response.decorator.js'

/** Функция-заглушка, изображающая тело метода-хендлера. */
function fakeHandler(): () => void {
  return () => undefined
}

/** Применяет `@ApiSuccessResponse(meta)` к `handler` ровно так, как это делает TS для method-декоратора. */
function applyToHandler(meta: ApiSuccessResponseMeta, handler: () => void): void {
  const descriptor: TypedPropertyDescriptor<() => void> = { value: handler }
  ApiSuccessResponse(meta)({}, 'handler', descriptor)
}

describe('@ApiSuccessResponse() (DTJ-018/DTJ-021)', () => {
  const reflector = new Reflector()

  it('1. применён к handler-у → Reflector читает переданные dtoName/status без искажений', () => {
    const handler = fakeHandler()
    applyToHandler({ dtoName: 'AuthOtpResponseDto', status: 200 }, handler)
    const read = reflector.get<ApiSuccessResponseMeta>(API_SUCCESS_RESPONSE_KEY, handler)
    expect(read).toEqual({ dtoName: 'AuthOtpResponseDto', status: 200 })
  })

  it('2. handler без декоратора → метаданные отсутствуют (undefined)', () => {
    const handler = fakeHandler()
    const read = reflector.get<ApiSuccessResponseMeta>(API_SUCCESS_RESPONSE_KEY, handler)
    expect(read).toBeUndefined()
  })

  it('3. два независимых handler-а с разными meta → метаданные не путаются между ними', () => {
    const createHandler = fakeHandler()
    const listHandler = fakeHandler()
    applyToHandler({ dtoName: 'CreateStaffAccountResponseDto', status: 201 }, createHandler)
    applyToHandler({ dtoName: 'ListStaffAccountsResponseDto', status: 200 }, listHandler)

    expect(reflector.get<ApiSuccessResponseMeta>(API_SUCCESS_RESPONSE_KEY, createHandler)).toEqual({
      dtoName: 'CreateStaffAccountResponseDto',
      status: 201,
    })
    expect(reflector.get<ApiSuccessResponseMeta>(API_SUCCESS_RESPONSE_KEY, listHandler)).toEqual({
      dtoName: 'ListStaffAccountsResponseDto',
      status: 200,
    })
  })

  it('4. ключ метаданных — стабильная строка "api:success-response" (совпадает с тем, что зашито в декораторе)', () => {
    expect(API_SUCCESS_RESPONSE_KEY).toBe('api:success-response')
  })
})
