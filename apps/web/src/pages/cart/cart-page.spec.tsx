import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { useCartSessionStore } from '@/features/cart/model/cart-session-store'
import CartPage from './cart-page'

/**
 * `cart-page.spec.tsx` (DTJ-234) — смоук: `CartPage` — тонкая композиция `CartScreen`
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §5), реально рендерит его без падений.
 */

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

function stubFetch(impl: FetchImpl): void {
  vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))
}

beforeEach(() => {
  window.localStorage.clear()
  useCartSessionStore.setState({ sessionToken: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CartPage (DTJ-234)', () => {
  it('1. рендерит CartScreen (пустая корзина) без падений', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { items: [] }, meta: { pharmacyGroups: [], warnings: [] } }), {
          status: 200,
        }),
      ),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <MemoryRouter initialEntries={['/cart']}>
            <CartPage />
          </MemoryRouter>
        </LocaleProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('cart-empty-state')).toBeInTheDocument()
    })
  })
})
