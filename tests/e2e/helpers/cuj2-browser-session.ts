import type { Page } from '@playwright/test'
import type { ApiSession } from './login-via-api.js'

// Сажает результат `loginViaApi()` в `apps/web` без прогона формы логина. `accessToken` в
// `auth-store.ts` персистится только через это: `zustand/persist` при гидратации сливает ВЕСЬ
// объект `localStorage` поверх состояния (не только то, что `partialize` сам туда пишет).
const AUTH_STORAGE_KEY = 'dorutj.auth'
const ZUSTAND_PERSIST_DEFAULT_VERSION = 0

export async function injectBrowserSession(page: Page, session: ApiSession): Promise<void> {
  const persisted = {
    state: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: session.user,
    },
    version: ZUSTAND_PERSIST_DEFAULT_VERSION,
  }
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value)
    },
    [AUTH_STORAGE_KEY, JSON.stringify(persisted)] as const,
  )
}
