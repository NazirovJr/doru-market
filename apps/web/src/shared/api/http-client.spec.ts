import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/api/auth-store'
import { httpRequest } from '@/shared/api/http-client'
import { getClientEnv } from '@/shared/config/env'

/**
 * Мокает fetch напрямую (vi.stubGlobal), а не msw: пакет msw уже объявлен в package.json как
 * devDependency для этого тикета, но текущая версия eslint-plugin-import-x/unrs-resolver в этом
 * окружении падает (краш парсера, не сообщение о нарушении) на самом факте импорта 'msw' в любом
 * файле — см. итог локальной проверки при сдаче тикета. Тест-план DTJ-003 явно разрешает "msw ИЛИ
 * АНАЛОГ" — vi.stubGlobal('fetch', ...) — полный функциональный эквивалент для целей этого теста.
 */

const apiBaseUrl = getClientEnv().apiBaseUrl
const refreshUrl = `${apiBaseUrl}/api/v1/auth/refresh`

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

function tokenExpiredResponse(): Response {
  return new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED' } }), { status: 401 })
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
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
      if (input === refreshUrl) {
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

  it('не зацикливается: повторный 401 после refresh не вызывает refresh снова', async () => {
    let refreshCalls = 0
    const fetchMock = vi.fn((input: string) => {
      if (input === refreshUrl) {
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
})
