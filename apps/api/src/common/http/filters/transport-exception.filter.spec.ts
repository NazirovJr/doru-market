import { type ArgumentsHost, HttpException } from '@nestjs/common'
import { ErrorCode } from '@dorutj/contracts'
import { describe, expect, it } from 'vitest'
import { TransportExceptionFilter } from './transport-exception.filter.js'

function makeArgsHost(reply: { status: (n: number) => typeof reply; send: (b: unknown) => unknown }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost
}

describe('TransportExceptionFilter (DTJ-018, SRS-API-016)', () => {
  const filter = new TransportExceptionFilter()

  it('1. NotFoundException (HttpException 404) → 404 NOT_FOUND envelope', () => {
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
    filter.catch(new HttpException('not found', 404), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 404 })
    const body = sent[1] as { error: { code: string; message: string } }
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND)
  })

  it('2. BadRequestException (HttpException 400) → 400 VALIDATION_ERROR envelope', () => {
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
    filter.catch(new HttpException('bad', 400), makeArgsHost(reply))
    const body = sent[1] as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
  })

  it('3. неожиданная Error → 500 INTERNAL_ERROR, без stack в HTTP', () => {
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
    filter.catch(new TypeError('internal boom'), makeArgsHost(reply))
    expect(sent[0]).toEqual({ status: 500 })
    const body = sent[1] as { error: { code: string; message: string; details?: { requestId?: string } } }
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(body.error.message).toBe('Internal server error')
    // Без RequestContext в тестах requestId отсутствует — это OK.
    expect(body.error.details?.requestId).toBeUndefined()
  })

  it('4. ConflictException (HttpException 409) → 409 CONFLICT envelope', () => {
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
    filter.catch(new HttpException('conflict', 409), makeArgsHost(reply))
    const body = sent[1] as { error: { code: string } }
    expect(body.error.code).toBe(ErrorCode.CONFLICT)
  })
})
