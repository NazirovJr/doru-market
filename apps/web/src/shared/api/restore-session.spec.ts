import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/api/auth-store'
import { restoreSession } from '@/shared/api/http-client'
import { getClientEnv } from '@/shared/config/env'

const refreshUrl = `${getClientEnv().apiBaseUrl}/api/v1/auth/refresh`

const user = { id: 'u1', role: 'customer', tenantId: null, phoneNumber: '+992900000000', fullName: null }

function refreshResponse(): Response {
  return new Response(JSON.stringify({ data: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh', user } }), { status: 200 })
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('restoreSession', () => {
  it('есть refreshToken и нет accessToken — обновляет сессию через /auth/refresh', async () => {
    useAuthStore.setState({ refreshToken: 'stored-refresh', user })
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) => refreshResponse())
    vi.stubGlobal('fetch', fetchMock)

    await restoreSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(refreshUrl)
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ refreshToken: 'stored-refresh' })
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' })
  })

  it('гость (нет refreshToken) — сеть не трогает', async () => {
    const fetchMock = vi.fn((_input: string, _init?: RequestInit) => refreshResponse())
    vi.stubGlobal('fetch', fetchMock)

    await restoreSession()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refresh отклонён — сессия очищена, гость', async () => {
    useAuthStore.setState({ refreshToken: 'revoked', user })
    vi.stubGlobal('fetch', vi.fn(() => new Response(JSON.stringify({ error: { code: 'REFRESH_TOKEN_INVALID' } }), { status: 401 })))

    await restoreSession()

    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, refreshToken: null, user: null })
  })

  it('API недоступен — не бросает, refreshToken остаётся для следующей попытки', async () => {
    useAuthStore.setState({ refreshToken: 'stored-refresh', user })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network down'))))

    await expect(restoreSession()).resolves.toBeUndefined()
    expect(useAuthStore.getState().refreshToken).toBe('stored-refresh')
  })
})
