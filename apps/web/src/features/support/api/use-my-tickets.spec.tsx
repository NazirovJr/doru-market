/**
 * `use-my-tickets.spec.tsx` (DTJ-284) — `enabled: false` (гость без `accessToken`) не отправляет
 * запрос вовсе (см. JSDoc `MyTicketsList.tsx` про гейт аутентификации).
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMyTickets } from './use-my-tickets'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function makeWrapper(queryClient: QueryClient): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMyTickets (DTJ-284)', () => {
  it('enabled: false → fetch НЕ вызывается', () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useMyTickets({ enabled: false }), { wrapper: makeWrapper(queryClient) })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enabled: true (по умолчанию) → загружает список', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'ticket-1' }] }), { status: 200 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useMyTickets(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => { expect(result.current.data).toHaveLength(1) })
  })
})
