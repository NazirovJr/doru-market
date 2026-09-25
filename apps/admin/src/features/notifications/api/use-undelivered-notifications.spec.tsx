import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getClientEnv } from '@/shared/api/http-client'
import { useUndeliveredNotifications, type UndeliveredNotificationDto } from './use-undelivered-notifications'

const API_BASE = getClientEnv().apiBaseUrl

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function makeWrapper(): ({ children }: { readonly children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const GROUP: UndeliveredNotificationDto = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  eventType: 'order.paid',
  sourceEventId: 'event-1',
  attempts: [{ channel: 'telegram', status: 'failed', failedReason: 'нет telegram_chat_id', attemptedAt: '2026-09-01T00:00:00.000Z' }],
  lastAttemptAt: '2026-09-01T00:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useUndeliveredNotifications', () => {
  it('GET /api/v1/notifications/undelivered с limit, читает pagination из meta', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(jsonResponse({ data: [GROUP], meta: { pagination: { nextCursor: 'cur-1', hasMore: true, limit: 50 } } })),
    )

    const { result } = renderHook(() => useUndeliveredNotifications(null), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe(`${API_BASE}/api/v1/notifications/undelivered`)
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.has('cursor')).toBe(false)
    expect(result.current.data).toEqual({ items: [GROUP], nextCursor: 'cur-1', hasMore: true })
  })

  it('cursor передан — попадает в query string', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse({ data: [] })))

    const { result } = renderHook(() => useUndeliveredNotifications('cur-2'), { wrapper: makeWrapper() })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })

    const url = new URL(fetchMock.mock.calls[0]![0])
    expect(url.searchParams.get('cursor')).toBe('cur-2')
    expect(result.current.data).toEqual({ items: [], nextCursor: null, hasMore: false })
  })
})
