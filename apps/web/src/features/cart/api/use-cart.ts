import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { HttpError } from '@/shared/api/http-client'
import { fetchCart, type CartView } from './cart.api'

/**
 * `use-cart.ts` (DTJ-234, EP-09, `SRS-ORD-002/005/010/012`) — TanStack Query поверх
 * `GET /api/v1/cart`.
 *
 * `CART_QUERY_KEY` — стабильный ключ (НЕ включает `extendHold`): `extendHold` — поведенческий
 * флаг конкретного вызова (продлить холд НА ЭТОМ запросе), а не часть идентичности ресурса
 * «корзина» — два запроса с разным `extendHold` обязаны читать/писать ОДНУ и ту же кэш-запись,
 * иначе мутации (`use-cart-mutations.ts`, `invalidateQueries(CART_QUERY_KEY)`) промахивались бы
 * мимо части кэша. Единственный сегодняшний потребитель — `CartScreen` с `extendHold: true` —
 * если появится второй (например, бейдж счётчика корзины в шапке, вне этого тикета) с
 * `extendHold: false`, стоит перепроверить, что порядок монтирования не важен для правильности.
 */
export const CART_QUERY_KEY = ['cart'] as const

export interface UseCartOptions {
  /** SRS-ORD-005: продлить мягкий холд остатка ДО сборки ответа. По умолчанию `false` — только
   *  экран корзины (`CartScreen`) шлёт `true` при открытии. */
  readonly extendHold?: boolean
}

export function useCart(options: UseCartOptions = {}): UseQueryResult<CartView, HttpError> {
  const extendHold = options.extendHold ?? false
  return useQuery<CartView, HttpError>({
    queryKey: CART_QUERY_KEY,
    queryFn: () => fetchCart(extendHold),
  })
}
