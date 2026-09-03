import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * `cart-session-store.ts` (DTJ-234, EP-09) — персистентное хранилище `X-Cart-Session-Token`
 * (решение CTO D-EP09-23, см. JSDoc `apps/api/.../cart/guards/cart-identity.guard.ts`).
 *
 * Правила обращения с токеном (тикет DTJ-234, «Идентификация корзины»):
 *   1. Токен выдаёт ТОЛЬКО сервер (заголовок ответа `X-Cart-Session-Token`) — этот стор НИКОГДА
 *      сам не генерирует значение, только принимает готовое через `setToken`.
 *   2. Сервер выдаёт НОВЫЙ токен в т.ч. когда клиент прислал неизвестный ему токен (защита от
 *      session fixation) — `cart.api.ts` вызывает `setToken` на КАЖДЫЙ ответ, где заголовок
 *      присутствует, безусловно перезаписывая старое значение (устаревший токен, отправленный
 *      этим же запросом, СРАЗУ становится недействительным для следующего запроса).
 *   3. Токен никогда не попадает в URL/query — только в заголовок (`cart.api.ts`).
 *   4. Хранится в `localStorage` (в отличие от `accessToken` в `auth-store.ts`, который держится
 *      только в памяти — здесь другой уровень риска: гостевая корзина, не JWT-сессия
 *      аутентифицированного пользователя).
 *   5. Для аутентифицированного пользователя заголовок не нужен — `cart.api.ts` сам решает, когда
 *      прикладывать `sessionToken` из этого стора (не шлёт его, когда `useAuthStore` несёт
 *      `accessToken`), стор здесь ничего не знает про auth-состояние.
 */

const CART_SESSION_STORAGE_KEY = 'dorutj.cart-session'

export interface CartSessionState {
  readonly sessionToken: string | null
  readonly setToken: (token: string) => void
  readonly clear: () => void
}

export const useCartSessionStore = create<CartSessionState>()(
  persist(
    (set) => ({
      sessionToken: null,
      setToken: (token): void => {
        set({ sessionToken: token })
      },
      clear: (): void => {
        set({ sessionToken: null })
      },
    }),
    {
      name: CART_SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
