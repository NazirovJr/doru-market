import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@dorutj/ui'
import { useT } from '@dorutj/i18n'
import { LocaleProvider, useLocale } from '@/shared/config/locale-provider'

/**
 * `providers.tsx` (DTJ-166, DTJ-433) — единая точка конфигурации провайдеров приложения:
 * TanStack Query (`retry: 1`, тот же приём, что `apps/web/src/app/providers/query-client.ts`) +
 * `LocaleProvider` (DTJ-433, тот же идиом, что `apps/web`) + `packages/ui` `ToastProvider`
 * (DTJ-406) — подключается ВНУТРИ `LocaleProvider`, т.к. `closeButtonLabel` берётся из `useT`.
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

const LocalizedToastProvider = ({ children }: AppProvidersProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return <ToastProvider closeButtonLabel={t('common.close')}>{children}</ToastProvider>
}

export const AppProviders = ({ children }: AppProvidersProps): ReactElement => (
  <QueryClientProvider client={queryClient}>
    <LocaleProvider>
      <LocalizedToastProvider>{children}</LocalizedToastProvider>
    </LocaleProvider>
  </QueryClientProvider>
)
