import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { HttpError } from '@/shared/api/http-client'
import { fetchCheckoutCart, type CheckoutCartSummary } from './checkout-cart.api'

/**
 * `use-checkout-cart.ts` (DTJ-235) — TanStack Query поверх `checkout-cart.api.ts`.
 *
 * `CHECKOUT_CART_QUERY_KEY` — намеренно ОТДЕЛЬНЫЙ ключ от `features/cart`'s `CART_QUERY_KEY`
 * (`['cart']`): их совпадение по значению позволило бы TanStack Query незаметно шарить кэш между
 * двумя независимыми фичами (ключи сравниваются по значению, не по ссылке на модуль) — то есть
 * `checkout` стал бы неявно завязан на форму данных `cart`-фичи БЕЗ единого импорта, который
 * ловит `pnpm arch:check`. Такая «невидимая» связь опаснее явного импорта: она не ловится
 * машинной проверкой и переживёт рефакторинг `cart`-фичи незамеченной. Цена — один лишний
 * `GET /cart` при переходе `/cart → /checkout` (кэш не переиспользуется), принята сознательно.
 *
 * `enabled` — `checkout-screen.tsx` передаёт `false`, пока пользователь не аутентифицирован
 * (см. JSDoc `checkout-cart.api.ts`) — запрос не улетает до наличия `accessToken`.
 */
export const CHECKOUT_CART_QUERY_KEY = ['checkout', 'cart-summary'] as const

export function useCheckoutCart(enabled: boolean): UseQueryResult<CheckoutCartSummary, HttpError> {
  return useQuery<CheckoutCartSummary, HttpError>({
    queryKey: CHECKOUT_CART_QUERY_KEY,
    queryFn: fetchCheckoutCart,
    enabled,
  })
}
