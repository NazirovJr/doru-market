import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { RequestContext, RequestContextMiddleware } from '@/common/context/request-context'

function createMockReqRes(headers: Record<string, string> = {}) {
  const setHeader = vi.fn<(name: string, value: string) => void>()
  const req = { headers } as unknown as IncomingMessage
  const res = { setHeader } as unknown as ServerResponse
  return { req, res, setHeader }
}

describe('RequestContextMiddleware', () => {
  it('генерирует requestId и отдаёт его в заголовке ответа, если X-Request-Id отсутствует', () => {
    const middleware = new RequestContextMiddleware()
    const { req, res, setHeader } = createMockReqRes()
    const next = vi.fn()

    middleware.use(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String))
  })

  it('переиспользует валидный клиентский X-Request-Id как есть (SRS-API-011)', () => {
    const middleware = new RequestContextMiddleware()
    const validId = randomUUID()
    const { req, res, setHeader } = createMockReqRes({ 'x-request-id': validId })

    middleware.use(req, res, () => undefined)

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', validId)
  })

  it('генерирует новый requestId, если клиентский заголовок невалиден', () => {
    const middleware = new RequestContextMiddleware()
    const { req, res, setHeader } = createMockReqRes({ 'x-request-id': 'not-a-uuid' })

    middleware.use(req, res, () => undefined)

    const [, generatedId] = setHeader.mock.calls[0]!
    expect(generatedId).not.toBe('not-a-uuid')
  })

  it('распространяет контекст на весь синхронный стек внутри next() и очищает его после', () => {
    const middleware = new RequestContextMiddleware()
    const { req, res } = createMockReqRes()
    let observedTenantId: string | null | undefined

    middleware.use(req, res, () => {
      RequestContext.patch({ tenantId: 'tenant-1' })
      observedTenantId = RequestContext.get()?.tenantId
    })

    expect(observedTenantId).toBe('tenant-1')
    expect(RequestContext.get()).toBeUndefined()
  })

  it('RequestContext.patch() вне активного контекста — безопасный no-op', () => {
    expect(() => {
      RequestContext.patch({ userId: 'user-1' })
    }).not.toThrow()
    expect(RequestContext.get()).toBeUndefined()
  })
})
