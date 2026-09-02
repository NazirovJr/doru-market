/**
 * Тест `@Idempotent()` (DTJ-019): декоратор реально вешает метаданные под
 * ключом `IDEMPOTENT_METADATA_KEY`, читаемые ТЕМ ЖЕ способом, что и
 * `IdempotencyInterceptor` — `Reflector.getAllAndOverride` по `[handler, class]`
 * (см. `idempotency.interceptor.ts`).
 */
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { Idempotent, IDEMPOTENT_METADATA_KEY } from './idempotent.decorator.js'

/** Функция-заглушка как цель для `SetMetadata` — тело не пустое, чтобы не путать с методом-объектом. */
function fakeHandler(): () => void {
  return () => undefined
}

/** Читает метаданные ровно так, как это делает `IdempotencyInterceptor.intercept`. */
function readIsIdempotent(
  reflector: Reflector,
  handler: () => void,
  klass: new () => unknown,
): boolean | undefined {
  return reflector.getAllAndOverride<boolean>(IDEMPOTENT_METADATA_KEY, [handler, klass])
}

describe('@Idempotent() (DTJ-019)', () => {
  const reflector = new Reflector()

  it('1. применён к методу (функции-хендлеру) → Reflector видит true на этом handler', () => {
    class Controller { readonly marker = true }
    const handler = fakeHandler()
    Idempotent()(handler)
    expect(readIsIdempotent(reflector, handler, Controller)).toBe(true)
  })

  it('2. handler БЕЗ декоратора и класс без декоратора → Reflector не находит метаданные (undefined)', () => {
    class Controller { readonly marker = true }
    const handler = fakeHandler()
    expect(readIsIdempotent(reflector, handler, Controller)).toBeUndefined()
  })

  it('3. применён к классу целиком → handler без собственного маркера всё равно помечен через fallback на класс', () => {
    class Controller { readonly marker = true }
    Idempotent()(Controller)
    const handler = fakeHandler()
    expect(readIsIdempotent(reflector, handler, Controller)).toBe(true)
  })

  it('4. декоратор использует именно ключ `Symbol.for(\'@dorutj/common/idempotent\')` — совпадает с ключом, который читает интерсептор', () => {
    expect(IDEMPOTENT_METADATA_KEY).toBe(Symbol.for('@dorutj/common/idempotent'))
  })

  it('5. декоратор применён к одному handler-у, но не к другому → изоляция по handler (соседний метод не помечен)', () => {
    class Controller { readonly marker = true }
    const idempotentHandler = fakeHandler()
    const plainHandler = fakeHandler()
    Idempotent()(idempotentHandler)
    expect(readIsIdempotent(reflector, plainHandler, Controller)).toBeUndefined()
    expect(readIsIdempotent(reflector, idempotentHandler, Controller)).toBe(true)
  })
})
