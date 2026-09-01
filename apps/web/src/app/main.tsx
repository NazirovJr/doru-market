import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { queryClient } from '@/app/providers/query-client'
import { LocaleProvider } from '@/shared/config/locale-provider'
import { router } from '@/app/router'
import '@/app/styles.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Корневой DOM-узел #root не найден — проверь apps/web/index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
)
