/**
 * `use-create-ticket.spec.tsx` (DTJ-284) — `onSuccess` инвалидирует «мои обращения» (свежесозданный
 * тикет обязан появиться в `MyTicketsList` без ручного рефреша).
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCreateTicket } from './use-create-ticket'
import { MY_TICKETS_QUERY_KEY } from './use-my-tickets'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): void {
  vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))
}

function makeWrapper(queryClient: QueryClient): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCreateTicket (DTJ-284)', () => {
  it('успешное создание инвалидирует query "my-tickets"', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: { id: 'ticket-1' } }), { status: 201 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateTicket(), { wrapper: makeWrapper(queryClient) })

    result.current.mutate({ category: 'other', description: 'проблема' })

    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: MY_TICKETS_QUERY_KEY })
  })
})
