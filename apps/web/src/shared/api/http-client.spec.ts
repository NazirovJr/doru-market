import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/api/auth-store'
import { httpGetJson, httpGetJsonWithMeta, HttpError, httpRequest } from '@/shared/api/http-client'
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

/**
 * `httpGetJsonWithMeta` (DTJ-193, `SRS-API-004/005`) — расширение `httpGetJson`, сохраняющее
 * `meta` конверта (курсорная пагинация `GET /medicines/search`).
 */
describe('httpGetJsonWithMeta', () => {
  it('возвращает data и meta.pagination из конверта', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ data: [{ id: '1' }], meta: { pagination: { nextCursor: 'abc', hasMore: true, limit: 20 } } }),
            { status: 200 },
          ),
        ),
      ),
    )

    const result = await httpGetJsonWithMeta<readonly { id: string }[]>('/things', { q: 'x' })

    expect(result.data).toEqual([{ id: '1' }])
    expect(result.meta).toEqual({ pagination: { nextCursor: 'abc', hasMore: true, limit: 20 } })
  })

  it('meta отсутствует в ответе — meta undefined, не бросает', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))))

    const result = await httpGetJsonWithMeta<readonly unknown[]>('/things')

    expect(result.data).toEqual([])
    expect(result.meta).toBeUndefined()
  })
})

/**
 * `SRS-CAT-075`/`TC-CAT-025`: `DomainExceptionFilter` (`apps/api/.../domain-exception.filter.ts`)
 * урезает `error.code`/`details` до обобщённых для ЛЮБОГО статуса `>=500` — `HttpError.status`
 * (взятый из реального `response.status`, не из тела) остаётся ЕДИНСТВЕННЫМ надёжным сигналом
 * для распознавания деградации поиска на клиенте (`use-search-results.ts`, DTJ-193).
 */
describe('httpGetJson — статус ответа переживает урезание тела фильтром (SRS-CAT-075)', () => {
  it('503 с обобщённым INTERNAL_ERROR в теле — HttpError.status всё равно 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }), {
            status: 503,
          }),
        ),
      ),
    )

    let caught: unknown
    try {
      await httpGetJson('/medicines/search')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(HttpError)
    if (caught instanceof HttpError) {
      expect(caught.status).toBe(503)
      expect(caught.code).toBe('INTERNAL_ERROR')
    }
  })
})
