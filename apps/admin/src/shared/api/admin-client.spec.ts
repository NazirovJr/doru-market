import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError, adminRequest } from './admin-client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('adminRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('запрашивает путь с префиксом /api/v1 и возвращает распарсенный JSON при успехе', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: '1' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await adminRequest<{ data: { id: string } }>('/admin/tenants')

    expect(result).toEqual({ data: { id: '1' } })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/tenants'), expect.anything())
  })

  it('бросает AdminApiError с code/message из конверта { error: {...} } при неуспехе', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Нет доступа' } })),
    )

    await expect(adminRequest('/admin/tenants')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Нет доступа',
    })
    await expect(adminRequest('/admin/tenants')).rejects.toBeInstanceOf(AdminApiError)
  })

  it('переносит details из конверта ошибки', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'bad', details: { field: 'name' } } })),
    )

    await expect(adminRequest('/admin/tenants')).rejects.toMatchObject({ details: { field: 'name' } })
  })

  it('фолбэк на INTERNAL_ERROR, если тело ошибки не JSON/не конверт', async () => {
    const brokenResponse = new Response('not json', { status: 500 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenResponse))

    await expect(adminRequest('/admin/tenants')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })
})
