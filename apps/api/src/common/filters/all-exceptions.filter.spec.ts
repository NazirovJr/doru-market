import { type ArgumentsHost, HttpException, Logger, UnauthorizedException } from '@nestjs/common'
import { DomainError, ErrorCode, NotFoundError, ValidationError } from '@dorutj/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AllExceptionsFilter } from './all-exceptions.filter.js'

/** Доменная ошибка с кодом, которого НЕТ в `ERROR_HTTP_STATUS` — проверяет fallback `?? 500`. */
class UnknownCodeError extends DomainError {
  constructor() {
    super('NOT_A_REAL_CODE' as ErrorCode, 'unknown code boom')
  }
}

function makeReply(): {
  reply: { status: (n: number) => unknown; send: (b: unknown) => unknown }
  sent: unknown[]
} {
  const sent: unknown[] = []
  const reply = {
    status: (n: number) => {
      sent.push({ status: n })
      return reply
    },
    send: (b: unknown) => {
      sent.push(b)
      return reply
    },
  }
  return { reply, sent }
}

function makeArgsHost(reply: { status: (n: number) => unknown; send: (b: unknown) => unknown }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost
}

describe('AllExceptionsFilter (EP-01, DTJ-018/029)', () => {
  let filter: AllExceptionsFilter
  let loggedMessages: string[]

  beforeEach(() => {
    filter = new AllExceptionsFilter()
    loggedMessages = []
    // Глушим и перехватываем pino/Nest Logger — проверяем, что именно уходит в лог,
    // не давая реальным логам засорять вывод тестов.
    vi.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      loggedMessages.push(String(message))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. DomainError (NotFoundError) → статус и код берутся из ERROR_HTTP_STATUS, details пробрасываются', () => {
    const { reply, sent } = makeReply()
    filter.catch(new NotFoundError({ resource: 'order' }), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 404 })
    const body = sent[1] as { error: { code: string; message: string; details?: { resource: string } } }
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND)
    expect(body.error.details?.resource).toBe('order')
  })

  it('2. DomainError без details → ключ details ОТСУТСТВУЕТ в конверте (не details: undefined)', () => {
    const { reply, sent } = makeReply()
    filter.catch(new ValidationError('bad phone'), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 400 })
    const body = sent[1] as { error: Record<string, unknown> }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect('details' in body.error).toBe(false)
  })

  it('3. DomainError с кодом, отсутствующим в ERROR_HTTP_STATUS → fallback 500 + маскировка кода', () => {
    const { reply, sent } = makeReply()
    filter.catch(new UnknownCodeError(), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string; message: string } }
    // Ожидание СМЕНЕНО в волне 6 (решение CTO). Раньше здесь утверждался сырой
    // `NOT_A_REAL_CODE` — то есть внутреннее имя кода уходило клиенту. Нераспознанный код,
    // упавший в 500, — это программная ошибка, и по SRS-API-014/DTJ-193 статус 500 обязан
    // маскировать `code`/`details`. Ровно так вёл себя `DomainExceptionFilter`, который был
    // зарегистрирован рядом, но недостижим; два фильтра противоречили друг другу, и в проде
    // работал более слабый. Теперь поведение одно и совпадает с решением DTJ-193.
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(body.error.message).toBe('Internal server error')
  })

  it('4. HttpException с распознанным code в теле → статус БЕРЁТСЯ из ERROR_HTTP_STATUS, а НЕ из getStatus()', () => {
    // Гвард кидает UnauthorizedException (getStatus()===401), но код в теле —
    // CROSS_TENANT_ACCESS_DENIED, канонически 403 (см. JSDoc sendHttpException).
    const ex = new UnauthorizedException({ code: 'CROSS_TENANT_ACCESS_DENIED', message: 'cross tenant' })
    expect(ex.getStatus()).toBe(401)
    const { reply, sent } = makeReply()
    filter.catch(ex, makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 403 })
    const body = sent[1] as { error: { code: string; message: string } }
    expect(body.error.code).toBe(ErrorCode.CROSS_TENANT_ACCESS_DENIED)
    expect(body.error.message).toBe('cross tenant')
  })

  it('5. HttpException без code в теле (Zod BadRequestException) → код через mapHttpStatusToCode(status)', () => {
    const ex = new HttpException({ statusCode: 400, message: 'phone invalid', error: 'Bad Request' }, 400)
    const { reply, sent } = makeReply()
    filter.catch(ex, makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 400 })
    const body = sent[1] as { error: { code: string; message: string } }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(body.error.message).toBe('phone invalid')
  })

  it('6. HttpException с code в теле, но НЕ входящим в каталог ErrorCode → трактуется как отсутствие code', () => {
    const ex = new HttpException({ code: 'SOME_MADE_UP_CODE', message: 'weird', statusCode: 404 }, 404)
    const { reply, sent } = makeReply()
    filter.catch(ex, makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 404 })
    const body = sent[1] as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND)
  })

  it('7. HttpException со строковым телом (getResponse() — string) → message берётся из exception.message', () => {
    const ex = new HttpException('plain string body', 404)
    const { reply, sent } = makeReply()
    filter.catch(ex, makeArgsHost(reply))
    const body = sent[1] as { error: { message: string } }
    expect(body.error.message).toBe('plain string body')
  })

  it('8. HttpException со статусом без записи в mapHttpStatusToCode → code=INTERNAL_ERROR, но HTTP-статус сохраняется исходный (НЕ 500)', () => {
    const ex = new HttpException('teapot', 418)
    const { reply, sent } = makeReply()
    filter.catch(ex, makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 418 })
    const body = sent[1] as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
  })

  it('9. Обычная Error (не HttpException, не DomainError) → 500 INTERNAL_ERROR, generic message, БЕЗ утечки stack клиенту', () => {
    const err = new TypeError('внутренний секретный stack trace')
    const { reply, sent } = makeReply()
    filter.catch(err, makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string; message: string } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(body.error.message).toBe('Internal server error')
    expect(JSON.stringify(body)).not.toContain('внутренний секретный stack trace')
    // В лог — попадает полный stack (для ops).
    expect(loggedMessages).toHaveLength(1)
    expect(loggedMessages[0]).toContain('внутренний секретный stack trace')
  })

  it('10. Не-Error значение (строка) → 500 generic envelope, в лог уходит String(exception)', () => {
    const { reply, sent } = makeReply()
    filter.catch('строковое исключение', makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string; message: string } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(body.error.message).toBe('Internal server error')
    expect(loggedMessages[0]).toContain('строковое исключение')
  })

  it('11. Не-Error значение (null) → не падает, отдаёт тот же generic envelope', () => {
    const { reply, sent } = makeReply()
    expect(() => {
      filter.catch(null, makeArgsHost(reply))
    }).not.toThrow()
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(loggedMessages[0]).toContain('null')
  })

  it('12. Не-Error значение (произвольный объект) → не падает, code=INTERNAL_ERROR', () => {
    const { reply, sent } = makeReply()
    filter.catch({ weird: 'payload' }, makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
  })
  // ---- Волна 6: перенос гарантий из недостижимых DomainExceptionFilter/TransportExceptionFilter ----

  it('13. ZodValidationPipe (тело `{error:{code,message,details}}`) → details.issues доходят до клиента', () => {
    // Регрессия, найденная на DTJ-226. Фильтр читал только ПЛОСКОЕ тело `{code,message}`,
    // а Zod-пайп кладёт всё на уровень глубже, под `error`. Итог: клиент получал
    // message «Bad Request Exception» и НИ ОДНОГО поля о том, что именно он прислал не так.
    const zodBody = {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: { issues: [{ path: 'quantity', message: 'must be positive' }] },
      },
    }
    const { reply, sent } = makeReply()
    filter.catch(new HttpException(zodBody, 400), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 400 })
    const body = sent[1] as { error: { code: string; message: string; details?: { issues?: unknown[] } } }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(body.error.message).toBe('Validation failed')
    expect(body.error.message).not.toBe('Bad Request Exception')
    expect(body.error.details?.issues).toEqual([{ path: 'quantity', message: 'must be positive' }])
  })

  it('14. Плоское тело гварда `{code,message}` продолжает работать (обе формы легальны)', () => {
    const { reply, sent } = makeReply()
    filter.catch(new UnauthorizedException({ code: ErrorCode.TOKEN_EXPIRED, message: 'expired' }), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 401 })
    const body = sent[1] as { error: { code: string; message: string } }
    expect(body.error.code).toBe(ErrorCode.TOKEN_EXPIRED)
    expect(body.error.message).toBe('expired')
  })

  it('15. DomainError со статусом 500 → code и details маскируются, оригинал НЕ утекает (SRS-API-014, DTJ-193)', () => {
    class InternalDomainError extends DomainError {
      constructor() {
        super(ErrorCode.INTERNAL_ERROR, 'db connection string invalid', { dsn: 'postgres://user:secret@host/db' })
      }
    }
    const { reply, sent } = makeReply()
    filter.catch(new InternalDomainError(), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string; message: string; details?: Record<string, unknown> } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(body.error.message).toBe('Internal server error')
    expect(body.error.details?.dsn).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('16. 503 — намеренная деградация, НЕ маскируется: code и details.reason доходят как есть', () => {
    // Маскируется РОВНО 500, не весь диапазон 5xx: клиент обязан отличать «поиск временно
    // деградировал» от «внутренняя ошибка», иначе фолбэк на стороне клиента невозможен.
    class DegradedError extends DomainError {
      constructor() {
        super(ErrorCode.SERVICE_UNAVAILABLE, 'search degraded', { reason: 'search_temporarily_degraded' })
      }
    }
    const { reply, sent } = makeReply()
    filter.catch(new DegradedError(), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 503 })
    const body = sent[1] as { error: { code: string; details?: { reason?: string } } }
    expect(body.error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE)
    expect(body.error.details?.reason).toBe('search_temporarily_degraded')
  })
})
