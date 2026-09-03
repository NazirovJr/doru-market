import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import CheckoutPage from './checkout-page'

/**
 * `checkout-page.spec.tsx` (DTJ-235) — смоук: `CheckoutPage` — тонкая композиция `CheckoutScreen`
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5), реально рендерит его без падений. Тот же приём, что
 * `pages/cart/cart-page.spec.tsx` (DTJ-234).
 */

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): void {
  vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))
}

beforeEach(() => {
  window.localStorage.clear()
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CheckoutPage (DTJ-235)', () => {
  it('1. рендерит CheckoutScreen (гость) без падений', async () => {
    stubFetch(() => Promise.reject(new Error('гость не должен инициировать сетевые запросы')))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/checkout']}>
            <CheckoutPage />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('checkout-unauthenticated')).toBeInTheDocument()
    })
  })
})
