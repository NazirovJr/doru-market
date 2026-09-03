/**
 * Unit-тесты `postJsonToBank` (EP-10, DTJ-239) — чистая обёртка над `fetch`, без БД.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { postJsonToBank } from './bank-fetch.util.js'

describe('postJsonToBank (DTJ-239)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POST с JSON-телом, заголовком Token (если передан токен), парсит JSON-ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ id: 'abc' }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await postJsonToBank<{ id: string }>('https://bank.example/invoice', { amount: '100' }, 'my-token')

    expect(result).toEqual({ id: 'abc' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://bank.example/invoice')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Token).toBe('my-token')
    expect(init.body).toBe(JSON.stringify({ amount: '100' }))
  })

  it('token undefined → без заголовка Token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    await postJsonToBank('https://bank.example/invoice', {}, undefined)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Token).toBeUndefined()
  })

  it('non-ok response → бросает с httpStatus', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(postJsonToBank('https://bank.example/invoice', {}, undefined)).rejects.toMatchObject({ httpStatus: 502 })
  })
})
