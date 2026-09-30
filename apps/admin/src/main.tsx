import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'
import { bootstrapBranding } from '@/app/bootstrap-branding'
import '@dorutj/ui/tokens.css'
import '@dorutj/ui/components.css'
import '@/app/styles.css'

const rootEl = document.getElementById('root')
if (rootEl === null) {
  throw new Error('root element not found')
}

void bootstrapBranding().then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </StrictMode>,
  )
})
