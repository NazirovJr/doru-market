import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@dorutj/ui'
import { useT } from '@dorutj/i18n'
import { LocaleProvider, useLocale } from '@/shared/config/locale-provider'

const DEFAULT_QUERY_RETRY_COUNT = 1

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: DEFAULT_QUERY_RETRY_COUNT } },
})

interface AppProvidersProps {
  readonly children: ReactNode
}

// closeButtonLabel читает useT, доступный только внутри LocaleProvider — отдельный компонент.
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
