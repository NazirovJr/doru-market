import { StrictMode, type ReactElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { ToastProvider } from '@dorutj/ui'
import { useT } from '@dorutj/i18n'
import { queryClient } from '@/app/providers/query-client'
import { restoreSession } from '@/shared/api/http-client'
import { LocaleProvider, useLocale } from '@/shared/config/locale-provider'
import { router } from '@/app/router'
import { bootstrapBranding } from '@/app/bootstrap-branding'
import '@dorutj/ui/tokens.css'
import '@dorutj/ui/components.css'
import '@/app/styles.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Корневой DOM-узел #root не найден — проверь apps/web/index.html')
}

// closeButtonLabel читает useT, доступный только внутри LocaleProvider.
const LocalizedToastProvider = ({ children }: { readonly children: ReactNode }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return <ToastProvider closeButtonLabel={t('common.close')}>{children}</ToastProvider>
}

// Сессию и бренд грузим до первого рендера, иначе корзина/шапка стартуют гостевыми и без бренда.
void Promise.allSettled([restoreSession(), bootstrapBranding()]).then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <LocalizedToastProvider>
            <RouterProvider router={router} />
          </LocalizedToastProvider>
        </LocaleProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
})
