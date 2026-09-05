import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * `providers.tsx` (DTJ-166) — единая точка конфигурации провайдеров приложения. Сейчас только
 * TanStack Query (`retry: 1` по умолчанию, тот же приём, что `apps/web/src/app/providers/query-client.ts`,
 * DTJ-003 шаг 2 — фичи не переопределяют retry-политику по месту использования). Точка расширения
 * для будущих провайдеров (например `LocaleProvider`, если кабинету аптеки понадобится
 * переключатель языка — см. TODO в `features/auth/ui/phone-step.tsx`).
 */
const DEFAULT_QUERY_RETRY_COUNT = 1

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: DEFAULT_QUERY_RETRY_COUNT,
    },
  },
})

interface AppProvidersProps {
  readonly children: ReactNode
}

export const AppProviders = ({ children }: AppProvidersProps): ReactElement => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)
