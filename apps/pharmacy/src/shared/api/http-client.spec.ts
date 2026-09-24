import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/api/auth-store'
import { httpRequest, HttpError, httpRequestJson, httpPostJson, httpPostForm } from '@/shared/api/http-client'

/**
 * DTJ-166 тест-план: «http-client повторяет запрос один раз после успешного refresh» и
 * «http-client редиректит на /login после повторного 401». Мокает fetch напрямую
 * (`vi.stubGlobal`), тот же приём, что `apps/web/src/shared/api/http-client.spec.ts`.
 */

const API_BASE_URL = 'http://localhost:3000'
const REFRESH_URL = `${API_BASE_URL}/api/v1/auth/refresh`

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

function tokenExpiredResponse(): Response {
  return new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED' } }), { status: 401 })
}

const originalLocation = window.location

/**
 * jsdom не позволяет `vi.spyOn(window.location, 'assign')` напрямую — `Location.prototype.assign`
 * не configurable в этой версии jsdom (`TypeError: Cannot redefine property`). Подменяем весь
 * `window.location` двойником-заглушкой вместо попытки шпионить за встроенным методом. Без
 * спреда `window.location` (класс `Location`) — `@typescript-eslint/no-misused-spread` (спред
 * инстанса класса теряет прототип); `redirectToLogin()` использует только `.assign`, копировать
 * остальные поля не нужно.
 */
function stubLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: { assign },
  })
  return assign
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: originalLocation })
})

describe('httpRequest', () => {
  it('добавляет Authorization при наличии токена в authStore', async () => {
    useAuthStore.setState({ accessToken: 'existing-token' })
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) => okResponse())
    vi.stubGlobal('fetch', fetchMock)

    await httpRequest('/whoami')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer existing-token')
  })

  it('не добавляет Authorization, когда токена нет', async () => {
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) => okResponse())
    vi.stubGlobal('fetch', fetchMock)

    await httpRequest('/whoami')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it('на 401 TOKEN_EXPIRED вызывает refresh ровно один раз и повторяет запрос с новым токеном', async () => {
    let refreshCalls = 0
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === REFRESH_URL) {
        refreshCalls += 1
        return new Response(JSON.stringify({ accessToken: 'refreshed-token' }), { status: 200 })
      }
      const isRefreshed = new Headers(init?.headers).get('authorization') === 'Bearer refreshed-token'
      return isRefreshed ? okResponse() : tokenExpiredResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await httpRequest('/protected')

    expect(refreshCalls).toBe(1)
    expect(response.status).toBe(200)
    expect(useAuthStore.getState().accessToken).toBe('refreshed-token')
  })

  it('дедуплицирует параллельные refresh: 2 запроса, упавшие в 401 одновременно, ждут ОДИН refresh', async () => {
    let refreshCalls = 0
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === REFRESH_URL) {
        refreshCalls += 1
        return new Response(JSON.stringify({ accessToken: 'refreshed-token' }), { status: 200 })
      }
      const isRefreshed = new Headers(init?.headers).get('authorization') === 'Bearer refreshed-token'
      return isRefreshed ? okResponse() : tokenExpiredResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([httpRequest('/a'), httpRequest('/b')])

    expect(refreshCalls).toBe(1)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it('критерий приёмки 3: не зацикливается — повторный 401 после refresh не вызывает refresh снова', async () => {
    let refreshCalls = 0
    const fetchMock = vi.fn((input: string) => {
      if (input === REFRESH_URL) {
        refreshCalls += 1
        return new Response(JSON.stringify({ accessToken: 'refreshed-token' }), { status: 200 })
      }
      return tokenExpiredResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await httpRequest('/still-protected')

    expect(refreshCalls).toBe(1)
    expect(response.status).toBe(401)
  })

  it('критерий приёмки 3: повторный 401 после успешного refresh редиректит на /login', async () => {
    const assignSpy = stubLocationAssign()
    const fetchMock = vi.fn((input: string) => {
      if (input === REFRESH_URL) {
        return new Response(JSON.stringify({ accessToken: 'refreshed-token' }), { status: 200 })
      }
      return tokenExpiredResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    await httpRequest('/still-protected')

    expect(assignSpy).toHaveBeenCalledExactlyOnceWith('/login')
  })

  it('критерий приёмки 3: неуспешный refresh (401) редиректит на /login и очищает сессию', async () => {
    useAuthStore.setState({
      accessToken: 'stale-token',
      refreshToken: 'stale-refresh',
      user: { id: 'u1', role: 'pharmacist', tenantId: null, phoneNumber: null, fullName: null },
    })
    const assignSpy = stubLocationAssign()
    const fetchMock = vi.fn((input: string) => {
      if (input === REFRESH_URL) {
        return new Response(JSON.stringify({ error: { code: 'REFRESH_TOKEN_INVALID' } }), { status: 401 })
      }
      return tokenExpiredResponse()
    })
    vi.stubGlobal('fetch', fetchMock)

    await httpRequest('/protected')

    expect(assignSpy).toHaveBeenCalledExactlyOnceWith('/login')
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('401 с другим кодом (не TOKEN_EXPIRED) — НЕ вызывает refresh и НЕ редиректит', async () => {
    const assignSpy = stubLocationAssign()
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await httpRequest('/protected')

    expect(response.status).toBe(401)
    expect(assignSpy).not.toHaveBeenCalled()
  })
})

describe('httpRequestJson / httpPostJson', () => {
  it('httpPostJson распаковывает data из envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: { otpRequestId: 'r1' } }), { status: 202 }))),
    )

    const result = await httpPostJson<{ otpRequestId: string }>('/api/v1/auth/otp/request', { phone: '+992937001122' })

    expect(result).toEqual({ otpRequestId: 'r1' })
  })

  it('ошибка envelope бросает HttpError с кодом и статусом ответа', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INVALID_PHONE_FORMAT', message: 'bad phone' } }), {
            status: 400,
          }),
        ),
      ),
    )

    let caught: unknown
    try {
      await httpRequestJson('/api/v1/auth/otp/request')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(HttpError)
    if (caught instanceof HttpError) {
      expect(caught.status).toBe(400)
      expect(caught.code).toBe('INVALID_PHONE_FORMAT')
    }
  })
})

/** ДОПОЛНЕНО DTJ-168: multipart-загрузка (Excel-импорт остатков) не должна получать ручной `Content-Type: application/json`. */
describe('httpPostForm', () => {
  it('не выставляет Content-Type вручную — fetch сам добавляет multipart boundary', async () => {
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ data: { ok: true } }), { status: 202 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const formData = new FormData()
    formData.append('mode', 'append_update')

    const result = await httpPostForm<{ ok: boolean }>('/api/v1/inventory-excel-import', formData)

    expect(result).toEqual({ ok: true })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).has('content-type')).toBe(false)
    expect(init.body).toBe(formData)
  })
})
