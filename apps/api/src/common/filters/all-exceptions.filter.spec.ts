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

  it('3. DomainError с кодом, отсутствующим в ERROR_HTTP_STATUS → fallback 500', () => {
    const { reply, sent } = makeReply()
    filter.catch(new UnknownCodeError(), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string } }
    // code в конверте — сырой (нераспознанный) код исключения, а не INTERNAL_ERROR.
    expect(body.error.code).toBe('NOT_A_REAL_CODE')
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
})
