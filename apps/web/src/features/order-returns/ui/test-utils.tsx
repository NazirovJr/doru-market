/**
 * `renderWithProviders` (DTJ-276) — общий render-helper `features/order-returns/ui/**`:
 * `QueryClientProvider` (свежий `QueryClient`, `retry: false`) + `LocaleProvider` (`useT`/
 * `useLocale`) + `MemoryRouter` — тот же набор, что `features/support/ui/test-utils.tsx` (DTJ-284).
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
