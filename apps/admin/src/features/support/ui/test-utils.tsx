/**
 * `renderWithProviders` (DTJ-283) — общий render-helper component-тестов `features/support/ui/**`:
 * `QueryClientProvider` (свежий `QueryClient` на тест — без `retry`, иначе таймауты ошибок
 * растягивают сьют) + `MemoryRouter` (`useSearchParams`/`Link`/`useParams` требуют router-контекст).
 */
import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'

export function renderWithProviders(ui: ReactElement, initialEntries: readonly string[] = ['/']): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[...initialEntries]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}
