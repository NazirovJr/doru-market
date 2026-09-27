import { describe, expect, it, vi } from 'vitest'
import { loginViaApi } from './login-via-api.js'

const BASE = 'http://localhost:3300'
const PHONE = '+992900000101'
const HTTP_TOO_MANY = 429

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('loginViaApi', () => {
  it('request → last-otp → verify, возвращает токены и пользователя', async () => {
    const session = { accessToken: 'a', refreshToken: 'r', user: { id: 'u', role: 'customer', tenantId: 't', phoneNumber: PHONE, fullName: null } }
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/otp/request')) return Promise.resolve(json({ data: { otpRequestId: 'req-1' } }, 202))
      if (url.includes('/_test/last-otp')) return Promise.resolve(json({ data: { code: '123456' } }))
      expect(JSON.parse(init?.body as string)).toEqual({ otpRequestId: 'req-1', code: '123456' })
      return Promise.resolve(json({ data: session }))
    })

    await expect(loginViaApi(PHONE, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toEqual(session)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('передаёт дополнительные заголовки (Host White-Label тенанта) в request и verify', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (init?.headers !== undefined) seen.push((init.headers as Record<string, string>)['x-forwarded-host'] ?? '')
      if (url.endsWith('/auth/otp/request')) return Promise.resolve(json({ data: { otpRequestId: 'req-1' } }, 202))
      if (url.includes('/_test/last-otp')) return Promise.resolve(json({ data: { code: '123456' } }))
      return Promise.resolve(json({ data: {} }))
    })

    await loginViaApi(PHONE, {
      baseUrl: BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      headers: { 'x-forwarded-host': 'sifat.dorutj.local' },
    })
    expect(seen).toEqual(['sifat.dorutj.local', 'sifat.dorutj.local'])
  })

  it('ошибка запроса OTP — понятное сообщение со статусом', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json({ error: { code: 'OTP_REQUEST_RATE_LIMITED' } }, HTTP_TOO_MANY)))
    await expect(loginViaApi(PHONE, { baseUrl: BASE, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/429/)
  })
})
