import type { CartItemResponseDto, CartPharmacyGroupDto, CartViewResponseDto } from '@dorutj/contracts'
import { httpGetJsonWithMeta } from '@/shared/api/http-client'

/**
 * `checkout-cart.api.ts` (DTJ-235, «Что сделать» §2: «сводка по группам аптек с доставкой из
 * `meta.pharmacyGroups`, полученных из корзины») — СОБСТВЕННЫЙ, независимый вызов
 * `GET /api/v1/cart` для checkout.
 *
 * **Почему не переиспользован `features/cart/api/cart.api.ts#fetchCart`.** Горизонтальный импорт
 * между фичами запрещён (`.dependency-cruiser.cjs` `fe-features-are-isolated`,
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §5: «общее выносится в entities или shared», а не
 * шарится напрямую между `features/*`) — `cart.api.ts` физически лежит в `features/cart/`, и
 * его импорт из `features/checkout/` роняет `pnpm arch:check`. Дублируется МИНИМАЛЬНЫЙ срез
 * (только `items`+`pharmacyGroups`, БЕЗ `warnings`/токена гостевой сессии корзины — см. ниже) —
 * не вся `cart.api.ts` целиком.
 *
 * **Без `X-Cart-Session-Token`.** `POST /api/v1/orders` (DTJ-233) требует `@Roles('customer')` —
 * оформить заказ гость физически не может, только аутентифицированный покупатель. `checkout-
 * screen.tsx` поэтому не рендерит форму (и не вызывает этот хук) без `accessToken`
 * (`useAuthStore`) — на этот экран гость не долетает, соответственно гостевой заголовок
 * `X-Cart-Session-Token` (`features/cart/model/cart-session-store.ts`, недоступен отсюда по той
 * же причине изоляции фич) здесь не нужен: `httpRequest`/`buildHeaders` уже прикладывает
 * `Authorization: Bearer` сам (`shared/api/http-client.ts`). Задокументированное ограничение —
 * см. отчёт сдачи, раздел ДОПУЩЕНИЯ.
 */

const CART_PATH = '/api/v1/cart'

export interface CheckoutCartSummary {
  readonly items: readonly CartItemResponseDto[]
  readonly pharmacyGroups: readonly CartPharmacyGroupDto[]
}

function isJsonArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

export async function fetchCheckoutCart(): Promise<CheckoutCartSummary> {
  const envelope = await httpGetJsonWithMeta<CartViewResponseDto>(CART_PATH)
  const pharmacyGroups = envelope.meta?.pharmacyGroups
  return {
    items: envelope.data.items,
    pharmacyGroups: isJsonArray(pharmacyGroups) ? (pharmacyGroups as readonly CartPharmacyGroupDto[]) : [],
  }
}
