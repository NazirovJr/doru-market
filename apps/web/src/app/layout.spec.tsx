import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { AppLayout } from '@/app/layout'
import { useCartSessionStore } from '@/features/cart/model/cart-session-store'
import { LocaleProvider } from '@/shared/config/locale-provider'

function renderLayout(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <QueryClientProvider client={queryClient}>
            <LocaleProvider>
              <AppLayout />
            </LocaleProvider>
          </QueryClientProvider>
        ),
        children: [{ index: true, element: <div data-testid="child">ok</div> }],
      },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  useCartSessionStore.setState({ sessionToken: null })
})

describe('AppLayout (smoke)', () => {
  it('рендерится с плейсхолдерами бренда/языка без падений', () => {
    renderLayout()

    expect(screen.getByTestId('brand-placeholder')).toHaveTextContent('[ Бренд ]')
    expect(screen.getByTestId('language-switcher-placeholder')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toHaveTextContent('ok')
  })

  it('в шапке есть ссылка на корзину', () => {
    renderLayout()

    expect(screen.getByTestId('header-cart-link')).toHaveAttribute('href', '/cart')
  })
})
