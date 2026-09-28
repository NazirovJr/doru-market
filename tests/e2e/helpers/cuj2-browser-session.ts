import type { Page } from '@playwright/test'
import type { ApiSession } from './login-via-api.js'

/**
 * Сажает результат `loginViaApi()` в `apps/web` без прогона формы логина (для сценариев, где
 * предмет проверки — не сам `/login`). `accessToken` в `auth-store.ts` — только в памяти
 * (`partialize` исключает его из `localStorage`), а `hydrate()` при старте НЕ РЕАЛИЗОВАН нигде
 * (см. отчёт сдачи) — просто положить `refreshToken` недостаточно. Обход: `zustand/persist` по
 * умолчанию сливает ВЕСЬ объект из `localStorage` поверх состояния при гидратации, не только то,
 * что `partialize` сам туда написал бы — `accessToken` в сохранённом JSON восстановится как
 * обычное поле. `page.addInitScript` пишет `localStorage` до создания стора.
 */
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
