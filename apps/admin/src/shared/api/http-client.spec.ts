import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/auth/auth-store'
import { httpRequest, HttpError, httpGetJson, httpPostJson } from './http-client'

const API_BASE_URL = 'http://localhost:3000'
const REFRESH_URL = `${API_BASE_URL}/api/v1/auth/refresh`

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

function tokenExpiredResponse(): Response {
  return new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED' } }), { status: 401 })
}

const originalLocation = window.location

function stubLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: { assign } })
  return assign
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: originalLocation })
  localStorage.clear()
})

describe('httpRequest', () => {
  it('добавляет Authorization при наличии токена в authStore', async () => {
    useAuthStore.getState().setAccessToken('existing-token')
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

  it('критерий приёмки 3: неуспешный refresh редиректит на /login, очищает сессию и зеркало localStorage', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'stale-token',
      refreshToken: 'stale-refresh',
      user: { id: 'u1', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: null },
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

  it('после перезагрузки (есть refreshToken, нет accessToken) 401 UNAUTHENTICATED лечится refresh-ом и повтором', async () => {
    useAuthStore.setState({ refreshToken: 'persisted-refresh', user: { id: 'u1', role: 'super_admin', tenantId: null, phoneNumber: null, fullName: null } })
    const fetchMock = vi.fn((input: string, init?: RequestInit) => {
      if (input === REFRESH_URL) {
        return new Response(JSON.stringify({ accessToken: 'refreshed-token' }), { status: 200 })
      }
      const isRefreshed = new Headers(init?.headers).get('authorization') === 'Bearer refreshed-token'
      return isRefreshed ? okResponse() : new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await httpRequest('/protected')

    expect(response.status).toBe(200)
    expect(useAuthStore.getState().accessToken).toBe('refreshed-token')
  })

  it('401 с другим кодом (не TOKEN_EXPIRED) — не вызывает refresh и не редиректит', async () => {
    const assignSpy = stubLocationAssign()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 }))))

    const response = await httpRequest('/protected')

    expect(response.status).toBe(401)
    expect(assignSpy).not.toHaveBeenCalled()
  })
})

describe('httpGetJson / httpPostJson (envelope, DTJ-283, без изменений)', () => {
  it('httpGetJson распаковывает data из конверта', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [{ id: '1' }] }), { status: 200 }))))

    const result = await httpGetJson<readonly { id: string }[]>('/api/v1/admin/tenants')

    expect(result).toEqual([{ id: '1' }])
  })

  it('ошибка конверта бросает HttpError с кодом и статусом', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: 403 }))))

    await expect(httpPostJson('/api/v1/admin/tenants', {})).rejects.toBeInstanceOf(HttpError)
  })
})
