/**
 * `renderWithProviders` (DTJ-284) — общий render-helper `features/support/ui/**`/`pages/support/**`:
 * `QueryClientProvider` (свежий `QueryClient`, `retry: false`) + `LocaleProvider` (`useT`/
 * `useLocale`) + `MemoryRouter` (`useNavigate`/`useSearchParams`) — тот же набор, что
 * `cart-page.spec.tsx` (DTJ-234).
 */
import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocaleProvider } from '@/shared/config/locale-provider'

export function renderWithProviders(ui: ReactElement, initialEntries: readonly string[] = ['/']): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[...initialEntries]}>{ui}</MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  )
}
