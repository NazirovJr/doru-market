/**
 * Тест `IdempotencyInterceptor` (EP-01, DTJ-019, SRS-API-009/010) — 7 веток
 * логики из JSDoc самого интерцептора + резолвинг `userId` (`readUserId`).
 *
 * Хранилище — реальный `InMemoryIdempotencyKeysRepository` (не мок с нуля):
 * побочные эффекты (`createProcessing`/`markCompleted`) проверяются через
 * его реальное состояние, а не через подсчёт вызовов.
 *
 * Ловушка таймингов: `tap()` в интерцепторе вызывает `markCompleted` через
 * `void promise.catch(...)` — fire-and-forget, эмиссия значения подписчику
 * не ждёт его завершения. Поэтому после `firstValueFrom(...)` тесты
 * дополнительно `await` результат самого `markCompleted` (через shпион),
 * иначе провека состояния репозитория была бы гонкой самого теста.
 */
import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, type CallHandler, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type FastifyReply, type FastifyRequest } from 'fastify'
import { firstValueFrom, of, throwError } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@dorutj/contracts'
import { RequestContext, type RequestContextStore } from '@/common/context/request-context.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { HTTP_STATUS_OK } from '@/common/http/http-status.constants.js'
import { IdempotencyKeyConflictError } from './idempotency-keys.repository.js'
import { InMemoryIdempotencyKeysRepository } from './in-memory-idempotency-keys.repository.js'
import { IdempotencyInterceptor } from './idempotency.interceptor.js'

interface ConflictBody {
  error: { code: string; message: string; details: { reason: string } }
}

/** Общий помощник: подписаться и ожидать именно `ConflictException` с заданным `reason`. */
async function expectConflict(observable$: ReturnType<IdempotencyInterceptor['intercept']>, reason: string): Promise<void> {
  try {
    await firstValueFrom(observable$)
    expect.unreachable(`обязан бросить ConflictException (reason=${reason})`)
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException)
    const body = (error as ConflictException).getResponse() as ConflictBody
    expect(body.error.code).toBe(ErrorCode.IDEMPOTENCY_KEY_CONFLICT)
    expect(body.error.details.reason).toBe(reason)
  }
}

/** Мутируемый reply-двойник: интерцептор читает `statusCode` и вызывает `status(code)`. */
function makeReply(): FastifyReply {
  const reply = {
    statusCode: undefined as number | undefined,
    status(code: number) {
      reply.statusCode = code
      return reply
    },
  }
  return reply as unknown as FastifyReply
}

function makeRequest(input: {
  headerValue?: string
  body?: unknown
  method?: string
  url?: string
  userId?: string
}): FastifyRequest & { user?: { id: string } } {
  const headers: Record<string, string> = {}
  if (input.headerValue !== undefined) {
    headers['idempotency-key'] = input.headerValue
  }
  return {
    headers,
    method: input.method ?? 'POST',
    url: input.url ?? '/orders',
    body: input.body,
    user: input.userId !== undefined ? { id: input.userId } : undefined,
  } as unknown as FastifyRequest & { user?: { id: string } }
}

/** По образцу `tenant-scope.guard.spec.ts`: реальный `Reflector` + `@Idempotent()` на функции-заглушке. */
function makeContext(req: FastifyRequest, reply: FastifyReply, isIdempotent: boolean): ExecutionContext {
  const handler = (): void => undefined
  if (isIdempotent) {
    Idempotent()(handler)
  }
  return {
    getHandler: () => handler,
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext
}

/**
 * `handleSpy` возвращается ОТДЕЛЬНО от `next`: обращение к `next.handle` в `expect(...)`
 * ловится правилом `@typescript-eslint/unbound-method` (метод интерфейса `CallHandler`
 * извлекается как значение) — спай хранится в замыкании, а не читается через `next.handle`.
 */
function makeNext(returnValue: unknown = { data: { ok: true } }): { next: CallHandler; handleSpy: ReturnType<typeof vi.fn> } {
  const handleSpy = vi.fn(() => of(returnValue))
  return { next: { handle: handleSpy }, handleSpy }
}

describe('IdempotencyInterceptor (DTJ-019, SRS-API-009/010)', () => {
  it('0. маршрут БЕЗ @Idempotent() → заголовок игнорируется, контроллер вызывается напрямую', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const findSpy = vi.spyOn(repo, 'findByTriple')
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext({ data: { passthrough: true } })
    const ctx = makeContext(makeRequest({ userId: 'u1' }), makeReply(), false)

    const result = await firstValueFrom(interceptor.intercept(ctx, next))

    expect(result).toEqual({ data: { passthrough: true } })
    expect(handleSpy).toHaveBeenCalledTimes(1)
    expect(findSpy).not.toHaveBeenCalled()
  })

  it('1. @Idempotent() + запрос БЕЗ заголовка → 400 IDEMPOTENCY_KEY_REQUIRED, контроллер не вызывается', () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext()
    const ctx = makeContext(makeRequest({ userId: 'u1' }), makeReply(), true)

    expect(() => interceptor.intercept(ctx, next)).toThrow(BadRequestException)
    try {
      interceptor.intercept(ctx, next)
      expect.unreachable('обязан бросить без заголовка')
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as { code: string; details: { field: string } }
      expect(body.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REQUIRED)
      expect(body.details.field).toBe('idempotency-key')
    }
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('2. заголовок есть, но НЕ валидный UUID v4 → 400 VALIDATION_ERROR', () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext()
    const ctx = makeContext(makeRequest({ userId: 'u1', headerValue: 'not-a-uuid' }), makeReply(), true)

    try {
      interceptor.intercept(ctx, next)
      expect.unreachable('обязан бросить на невалидный формат ключа')
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const body = (error as BadRequestException).getResponse() as {
        code: string
        details: { field: string; value: string }
      }
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(body.details.value).toBe('not-a-uuid')
    }
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('3. первый запрос с валидным ключом → контроллер вызывается, ответ сохраняется как completed', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const markCompletedSpy = vi.spyOn(repo, 'markCompleted')
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const key = randomUUID()
    const { next, handleSpy } = makeNext({ data: { orderId: 'o1' } })
    const req = makeRequest({ userId: 'u1', headerValue: key, body: { amount: 100 } })
    const ctx = makeContext(req, makeReply(), true)

    const result = await firstValueFrom(interceptor.intercept(ctx, next))
    // markCompleted — fire-and-forget внутри tap(), дожидаемся реального завершения побочного эффекта.
    await markCompletedSpy.mock.results[0]?.value

    expect(result).toEqual({ data: { orderId: 'o1' } })
    expect(handleSpy).toHaveBeenCalledTimes(1)
    const stored = await repo.findByTriple('u1', 'POST /orders', key)
    expect(stored?.status).toBe('completed')
    expect(stored?.responseStatus).toBe(HTTP_STATUS_OK)
    expect(stored?.responseBody).toEqual({ data: { orderId: 'o1' } })
  })

  it('4. повтор с ТЕМ ЖЕ ключом и тем же телом → возвращён сохранённый ответ, контроллер НЕ вызывается повторно', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const markCompletedSpy = vi.spyOn(repo, 'markCompleted')
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const key = randomUUID()
    const { next, handleSpy } = makeNext({ data: { orderId: 'o1' } })
    const body = { amount: 100 }

    const firstCtx = makeContext(makeRequest({ userId: 'u1', headerValue: key, body }), makeReply(), true)
    await firstValueFrom(interceptor.intercept(firstCtx, next))
    await markCompletedSpy.mock.results[0]?.value

    // Второй запрос — НОВЫЙ reply, то же тело (структурно), тот же ключ.
    const secondReply = makeReply()
    const secondCtx = makeContext(
      makeRequest({ userId: 'u1', headerValue: key, body: { amount: 100 } }),
      secondReply,
      true,
    )
    const secondResult = await firstValueFrom(interceptor.intercept(secondCtx, next))

    expect(secondResult).toEqual({ data: { orderId: 'o1' } })
    // Суть идемпотентности: обработчик вызывался ОДИН раз за оба запроса.
    expect(handleSpy).toHaveBeenCalledTimes(1)
    expect(secondReply.statusCode).toBe(HTTP_STATUS_OK)
  })

  it('5. повтор с тем же ключом, но ДРУГИМ телом → 409 IDEMPOTENCY_KEY_CONFLICT (body_mismatch), контроллер не вызывается повторно', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const markCompletedSpy = vi.spyOn(repo, 'markCompleted')
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const key = randomUUID()
    const { next, handleSpy } = makeNext({ data: { orderId: 'o1' } })

    const firstCtx = makeContext(
      makeRequest({ userId: 'u1', headerValue: key, body: { amount: 100 } }),
      makeReply(),
      true,
    )
    await firstValueFrom(interceptor.intercept(firstCtx, next))
    await markCompletedSpy.mock.results[0]?.value

    const secondCtx = makeContext(
      makeRequest({ userId: 'u1', headerValue: key, body: { amount: 999 } }),
      makeReply(),
      true,
    )

    await expectConflict(interceptor.intercept(secondCtx, next), 'body_mismatch')
    expect(handleSpy).toHaveBeenCalledTimes(1)
  })

  it('6. незавершённый параллельный запрос с тем же ключом (status=processing) → 409 IDEMPOTENCY_KEY_CONFLICT (still_processing)', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    // Имитация запроса «в полёте»: запись создана, markCompleted ещё не вызывался.
    await repo.createProcessing({ userId: 'u1', endpoint: 'POST /orders', key: 'irrelevant', requestHash: 'h' })
    const key = randomUUID()
    await repo.createProcessing({ userId: 'u1', endpoint: 'POST /orders', key, requestHash: 'h-in-flight' })
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext()
    const ctx = makeContext(makeRequest({ userId: 'u1', headerValue: key, body: { any: true } }), makeReply(), true)

    await expectConflict(interceptor.intercept(ctx, next), 'still_processing')
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('7. гонка на createProcessing (два запроса одновременно проходят findByTriple=null) → 409 IDEMPOTENCY_KEY_CONFLICT (concurrent_request)', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    // findByTriple успевает вернуть null ДО того, как параллельный запрос вставил запись —
    // createProcessing() бросает IdempotencyKeyConflictError (уникальный индекс в реальной БД).
    vi.spyOn(repo, 'createProcessing').mockRejectedValueOnce(
      new IdempotencyKeyConflictError({ reason: 'triple already exists' }),
    )
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext()
    const ctx = makeContext(
      makeRequest({ userId: 'u1', headerValue: randomUUID(), body: { any: true } }),
      makeReply(),
      true,
    )

    await expectConflict(interceptor.intercept(ctx, next), 'concurrent_request')
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('8. ошибка обработчика → ошибка пробрасывается наружу, запись processing ОСВОБОЖДАЕТСЯ (не остаётся залипшей навсегда), markCompleted не вызывается', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const markCompletedSpy = vi.spyOn(repo, 'markCompleted')
    const releaseSpy = vi.spyOn(repo, 'releaseProcessing')
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const key = randomUUID()
    const failure = new Error('handler exploded')
    const next: CallHandler = { handle: vi.fn(() => throwError(() => failure)) }
    const ctx = makeContext(makeRequest({ userId: 'u1', headerValue: key, body: { x: 1 } }), makeReply(), true)

    await expect(firstValueFrom(interceptor.intercept(ctx, next))).rejects.toBe(failure)
    // releaseProcessing — fire-and-forget внутри tap({ error }), дожидаемся реального завершения.
    await releaseSpy.mock.results[0]?.value

    expect(markCompletedSpy).not.toHaveBeenCalled()
    // Запись удалена целиком (не «зависший» промежуточный статус) — как будто запроса не было.
    const stored = await repo.findByTriple('u1', 'POST /orders', key)
    expect(stored).toBeNull()
  })

  it('8d. ГЛАВНЫЙ СЦЕНАРИЙ ФИКСА: после ошибки обработчика повтор с ТЕМ ЖЕ ключом доходит до обработчика, а не получает 409 still_processing', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const releaseSpy = vi.spyOn(repo, 'releaseProcessing')
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const key = randomUUID()
    const body = { x: 1 }
    const failure = new Error('handler exploded')
    const failingNext: CallHandler = { handle: vi.fn(() => throwError(() => failure)) }

    const firstCtx = makeContext(makeRequest({ userId: 'u1', headerValue: key, body }), makeReply(), true)
    await expect(firstValueFrom(interceptor.intercept(firstCtx, failingNext))).rejects.toBe(failure)
    await releaseSpy.mock.results[0]?.value

    const { next: retryNext, handleSpy: retryHandleSpy } = makeNext({ data: { orderId: 'recovered' } })
    const retryCtx = makeContext(makeRequest({ userId: 'u1', headerValue: key, body }), makeReply(), true)

    const result = await firstValueFrom(interceptor.intercept(retryCtx, retryNext))

    expect(result).toEqual({ data: { orderId: 'recovered' } })
    expect(retryHandleSpy).toHaveBeenCalledTimes(1)
  })

  it('8a. findByTriple репозитория отклоняется (например, БД недоступна) → ошибка пробрасывается наружу, контроллер не вызывается', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const dbFailure = new Error('connection lost')
    vi.spyOn(repo, 'findByTriple').mockRejectedValueOnce(dbFailure)
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext()
    const ctx = makeContext(
      makeRequest({ userId: 'u1', headerValue: randomUUID(), body: { x: 1 } }),
      makeReply(),
      true,
    )

    await expect(firstValueFrom(interceptor.intercept(ctx, next))).rejects.toBe(dbFailure)
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('8b. createProcessing отклоняется НЕ IdempotencyKeyConflictError → исходная ошибка пробрасывается как есть (не подменяется на 409)', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const unexpected = new Error('unique violation, но не наш класс ошибки')
    vi.spyOn(repo, 'createProcessing').mockRejectedValueOnce(unexpected)
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext()
    const ctx = makeContext(
      makeRequest({ userId: 'u1', headerValue: randomUUID(), body: { x: 1 } }),
      makeReply(),
      true,
    )

    await expect(firstValueFrom(interceptor.intercept(ctx, next))).rejects.toBe(unexpected)
    expect(handleSpy).not.toHaveBeenCalled()
  })

  it('8c. markCompleted отклоняется ПОСЛЕ успешного ответа обработчика → клиент всё равно получает ответ, ошибка только логируется', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const persistFailure = new Error('write conflict on markCompleted')
    const markCompletedSpy = vi.spyOn(repo, 'markCompleted').mockRejectedValueOnce(persistFailure)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext({ data: { orderId: 'o1' } })
    const ctx = makeContext(
      makeRequest({ userId: 'u1', headerValue: randomUUID(), body: { x: 1 } }),
      makeReply(),
      true,
    )

    const result = await firstValueFrom(interceptor.intercept(ctx, next))
    // Дожидаемся отклонённого markCompleted: interceptor подписался на этот же promise
    // РАНЬШЕ (внутри tap()), поэтому его `.catch()` гарантированно отработает раньше этой строки.
    await expect(markCompletedSpy.mock.results[0]?.value).rejects.toBe(persistFailure)

    expect(result).toEqual({ data: { orderId: 'o1' } })
    expect(handleSpy).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith('idempotency markCompleted failed', persistFailure)
    consoleErrorSpy.mockRestore()
  })

  it('9. userId резолвится из RequestContext, когда req.user отсутствует (JWT ещё не проставил req.user)', async () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const markCompletedSpy = vi.spyOn(repo, 'markCompleted')
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const key = randomUUID()
    const { next } = makeNext({ data: { ok: true } })
    const req = makeRequest({ headerValue: key, body: { x: 1 } })
    const ctx = makeContext(req, makeReply(), true)
    const store: RequestContextStore = { requestId: randomUUID(), tenantId: null, userId: 'ctx-user', role: null }

    const result = await RequestContext.run(store, () => firstValueFrom(interceptor.intercept(ctx, next)))
    await markCompletedSpy.mock.results[0]?.value

    expect(result).toEqual({ data: { ok: true } })
    const stored = await repo.findByTriple('ctx-user', 'POST /orders', key)
    expect(stored?.status).toBe('completed')
  })

  it('10. ни req.user, ни RequestContext не дают userId → 400 UNAUTHENTICATED, контроллер не вызывается', () => {
    const reflector = new Reflector()
    const repo = new InMemoryIdempotencyKeysRepository()
    const interceptor = new IdempotencyInterceptor(reflector, repo)
    const { next, handleSpy } = makeNext()
    const req = makeRequest({ headerValue: randomUUID(), body: {} })
    const ctx = makeContext(req, makeReply(), true)

    try {
      interceptor.intercept(ctx, next)
      expect.unreachable('обязан бросить без резолвленного userId')
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      const body = (error as BadRequestException).getResponse() as { code: string }
      expect(body.code).toBe(ErrorCode.UNAUTHENTICATED)
    }
    expect(handleSpy).not.toHaveBeenCalled()
  })
})
