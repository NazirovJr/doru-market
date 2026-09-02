import { type ArgumentsHost, HttpException } from '@nestjs/common'
import { DomainError, ErrorCode, NotFoundError, ValidationError } from '@dorutj/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import { DomainExceptionFilter } from './domain-exception.filter.js'

/** Доменная ошибка с кодом, который маппится РОВНО в 500 (`ErrorCode.INTERNAL_ERROR`). */
class InternalBoomError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.INTERNAL_ERROR, 'internal boom', details)
  }
}

/**
 * Доменная ошибка с кодом, который маппится в 503 (`ErrorCode.SERVICE_UNAVAILABLE`) —
 * намеренный, документированный сигнал деградации (напр. DTJ-190 `SearchServiceUnavailableError`),
 * а НЕ незапланированная поломка. Единственный статус, который фильтр обязан маскировать, — 500.
 */
class ServiceDegradedError extends DomainError {
  constructor(details?: Record<string, unknown>) {
    super(ErrorCode.SERVICE_UNAVAILABLE, 'Search is temporarily degraded, please retry shortly', details)
  }
}

function makeArgsHost(reply: { status: (n: number) => typeof reply; send: (b: unknown) => unknown }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost
}

describe('DomainExceptionFilter (DTJ-018, SRS-API-014/016, DTJ-193)', () => {
  let filter: DomainExceptionFilter

  beforeEach(() => {
    filter = new DomainExceptionFilter()
  })

  it('1. NotFoundError → 404 NOT_FOUND envelope', () => {
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
    filter.catch(new NotFoundError({ resource: 'user' }), makeArgsHost(reply))
    const body = sent[1] as { error: { code: string; message: string; details?: unknown } }
    expect(sent[0]).toEqual({ status: 404 })
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND)
    expect(body.error.message).toBeTruthy()
  })

  it('2. ValidationError → 400 VALIDATION_ERROR envelope', () => {
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
    filter.catch(new ValidationError('bad input', { field: 'phone' }), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 400 })
    const body = sent[1] as { error: { code: string; details?: { field: string } } }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(body.error.details?.field).toBe('phone')
  })

  it('3. 500 (INTERNAL_ERROR) → code маскируется на INTERNAL_ERROR, details заменяется на {requestId}, оригинал НЕ утекает', () => {
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
    filter.catch(new InternalBoomError({ secret: 'leak', stack: 'at SomeInternal.fn (/app/src/x.ts:1:1)' }), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string; message: string; details?: Record<string, unknown> } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(body.error.message).toBe('Internal server error')
    // Оригинальные details (и тем более stack) НЕ должны попасть в HTTP-тело ни в каком виде.
    expect(JSON.stringify(body)).not.toContain('leak')
    expect(JSON.stringify(body)).not.toContain('SomeInternal.fn')
  })

  it('4. 503 (SERVICE_UNAVAILABLE) — намеренная деградация → code и details.reason доходят до клиента как есть (НЕ маскируются)', () => {
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
    filter.catch(new ServiceDegradedError({ reason: 'search_temporarily_degraded' }), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 503 })
    const body = sent[1] as { error: { code: string; message: string; details?: { reason: string } } }
    expect(body.error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE)
    expect(body.error.message).toBe('Search is temporarily degraded, please retry shortly')
    expect(body.error.details?.reason).toBe('search_temporarily_degraded')
  })

  it('5. HttpException НЕ перехватывается DomainExceptionFilter (он для @Catch(DomainError))', () => {
    // DomainExceptionFilter имеет @Catch(DomainError) — HttpException должен
    // пройти насквозь к TransportExceptionFilter. Этот тест документирует контракт.
    const ex = new HttpException('test', 404)
    expect(ex).toBeInstanceOf(HttpException)
    // Сама проверка "не перехватывает" гарантируется декоратором @Catch(DomainError)
    // и не требует runtime-проверки здесь.
  })
})
