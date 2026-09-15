/**
 * `my-tickets.api.spec.ts` (DTJ-284) — сетевой контракт `GET /api/v1/support-tickets`: без
 * `customerId` в query (сервер скоупит сам, ticket «Что сделать» п.4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientEnv } from '@/shared/config/env'
import { fetchMyTickets } from './my-tickets.api'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchMyTickets (DTJ-284)', () => {
  it('GET /api/v1/support-tickets без query-параметров, возвращает распакованный массив', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'ticket-1' }, { id: 'ticket-2' }] }), { status: 200 })),
    )

    const result = await fetchMyTickets()

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${getClientEnv().apiBaseUrl}/api/v1/support-tickets`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toHaveLength(2)
  })
})
