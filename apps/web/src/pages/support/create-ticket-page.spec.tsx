/**
 * `create-ticket-page.spec.tsx` (DTJ-284) — смоук + гейт аутентификации + чтение `?orderId=` из
 * query (АС1 тикета).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import CreateTicketPage from './create-ticket-page'

const AUTHENTICATED_USER = { id: 'customer-1', role: 'customer', tenantId: 'tenant-1', phoneNumber: null, fullName: null }

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
  const fetchMock = vi.fn<FetchImpl>(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <CreateTicketPage />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('CreateTicketPage (DTJ-284)', () => {
  it('гость (без accessToken) → экран "войдите", форма не рендерится', () => {
    renderAt('/support/new')
    expect(screen.getByTestId('create-ticket-unauthenticated')).toBeInTheDocument()
    expect(screen.queryByTestId('create-ticket-form')).not.toBeInTheDocument()
  })

  it('АС1 — авторизован, ?orderId=order-5 в URL → форма отправляет этот orderId', async () => {
    useAuthStore.setState({ accessToken: 'token', refreshToken: 'refresh', user: AUTHENTICATED_USER })
    const fetchMock = stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: { id: 't1' } }), { status: 201 })))
    renderAt('/support/new?orderId=order-5')

    fireEvent.change(screen.getByTestId('create-ticket-description'), { target: { value: 'проблема с этим заказом' } })
    fireEvent.click(screen.getByTestId('create-ticket-submit'))

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    const [, init] = fetchMock.mock.calls[0] ?? []
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body.orderId).toBe('order-5')
  })
})
