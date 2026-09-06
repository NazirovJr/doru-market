/**
 * `create-ticket.api.spec.ts` (DTJ-284) — сетевой контракт `POST /api/v1/support-tickets`:
 * `channel='in_app'` всегда, `orderId` передаётся только когда задан (АС1/АС2 тикета).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientEnv } from '@/shared/config/env'
import { createTicket, type CreateTicketInput } from './create-ticket.api'

const SUPPORT_TICKETS_URL = `${getClientEnv().apiBaseUrl}/api/v1/support-tickets`

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const BASE_INPUT: CreateTicketInput = { category: 'courier_conduct', description: 'курьер грубил' }

describe('createTicket (DTJ-284)', () => {
  it('АС1 — с orderId: POST /api/v1/support-tickets, тело несёт channel=in_app и orderId', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: 'ticket-1' } }), { status: 201 })),
    )

    await createTicket({ ...BASE_INPUT, orderId: 'order-1' })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(SUPPORT_TICKETS_URL)
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body).toEqual({ channel: 'in_app', category: 'courier_conduct', description: 'курьер грубил', orderId: 'order-1' })
  })

  it('АС2 — без orderId: тело НЕ содержит ключ orderId вовсе (не orderId: undefined)', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: 'ticket-2' } }), { status: 201 })),
    )

    await createTicket(BASE_INPUT)

    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect('orderId' in body).toBe(false)
  })

  it('возвращает распакованный data (SupportTicketDto)', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { id: 'ticket-3', status: 'open' } }), { status: 201 })),
    )

    const result = await createTicket(BASE_INPUT)

    expect(result).toEqual({ id: 'ticket-3', status: 'open' })
  })
})
