/**
 * `support-page.spec.tsx` (DTJ-284) — смоук: `SupportPage` — тонкая композиция
 * `ContactSupportButton`+`MyTicketsList` (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5), реально
 * рендерит их без падений.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import SupportPage from './support-page'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): void {
  vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

describe('SupportPage (DTJ-284)', () => {
  it('рендерит кнопку "написать в поддержку" + список обращений (гость) без падений', async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/support']}>
            <SupportPage />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('contact-support-button')).toBeInTheDocument()
    await waitFor(() => { expect(screen.getByTestId('my-tickets-unauthenticated')).toBeInTheDocument() })
  })
})
