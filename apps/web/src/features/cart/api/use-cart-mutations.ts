import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { HttpError } from '@/shared/api/http-client'
import {
  addCartItem,
  removeCartItem,
  updateCartItemQuantity,
  type AddCartItemInput,
  type AddCartItemResult,
  type CartView,
  type UpdateCartItemQuantityResult,
} from './cart.api'
import { CART_QUERY_KEY } from './use-cart'
import { applyCartItemQuantityLocally, removeCartItemLocally } from '../model/optimistic-cart-update'

/**
 * `use-cart-mutations.ts` (DTJ-234, EP-09, «Что сделать» §2) — `addItem`/`updateQuantity`/
 * `removeItem` поверх `cart.api.ts`. `updateQuantity`/`removeItem` — optimistic update
 * (`optimistic-cart-update.ts`) с откатом на `onError` и обязательной инвалидацией `useCart`
 * query key на `onSettled` (не `onSuccess` — инвалидация нужна И после отката ошибки, чтобы
 * подтянуть РЕАЛЬНОЕ состояние сервера, если откат разошёлся с ним). `addItem` — БЕЗ
 * оптимистичного пути (см. JSDoc `optimistic-cart-update.ts`), только инвалидация на успехе.
 *
 * `addItem` не вызывается ЭТИМ тикетом (`CartScreen` не добавляет позиции — экран,
 * инициирующий добавление в корзину, `/medicines/:id`, вне периметра `files_owned` DTJ-234) —
 * хук построен по явному требованию тикета «что сделать» §2 как переиспользуемая
 * инфраструктура для будущего потребителя; сам факт вызова проверен тестом
 * (`use-cart-mutations.spec.ts`), не UI этого экрана.
 */

interface OptimisticContext {
  readonly previous: CartView | undefined
}

export interface UseCartMutationsResult {
  readonly addItem: UseMutationResult<AddCartItemResult, HttpError, AddCartItemInput>
  readonly updateQuantity: UseMutationResult<
    UpdateCartItemQuantityResult,
    HttpError,
    { readonly cartItemId: string; readonly quantity: number },
    OptimisticContext
  >
  readonly removeItem: UseMutationResult<void, HttpError, string, OptimisticContext>
}

function rollbackOnError(
  queryClient: ReturnType<typeof useQueryClient>,
  context: OptimisticContext | undefined,
): void {
  if (context?.previous !== undefined) {
    queryClient.setQueryData(CART_QUERY_KEY, context.previous)
  }
}

function invalidateCart(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY })
}

/** Без оптимистичного пути — см. JSDoc `optimistic-cart-update.ts`. */
function useAddItemMutation(
  queryClient: ReturnType<typeof useQueryClient>,
): UseCartMutationsResult['addItem'] {
  return useMutation<AddCartItemResult, HttpError, AddCartItemInput>({
    mutationFn: addCartItem,
    onSuccess: () => {
      invalidateCart(queryClient)
    },
  })
}

function useUpdateQuantityMutation(
  queryClient: ReturnType<typeof useQueryClient>,
): UseCartMutationsResult['updateQuantity'] {
  return useMutation<
    UpdateCartItemQuantityResult,
    HttpError,
    { readonly cartItemId: string; readonly quantity: number },
    OptimisticContext
  >({
    mutationFn: ({ cartItemId, quantity }) => updateCartItemQuantity(cartItemId, quantity),
    onMutate: async ({ cartItemId, quantity }) => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY })
      const previous = queryClient.getQueryData<CartView>(CART_QUERY_KEY)
      if (previous !== undefined) {
        queryClient.setQueryData<CartView>(
          CART_QUERY_KEY,
          applyCartItemQuantityLocally(previous, cartItemId, quantity),
        )
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      rollbackOnError(queryClient, context)
    },
    onSettled: () => {
      invalidateCart(queryClient)
    },
  })
}

function useRemoveItemMutation(
  queryClient: ReturnType<typeof useQueryClient>,
): UseCartMutationsResult['removeItem'] {
  // Без явного `<void, ...>` — `@typescript-eslint/no-invalid-void-type` (`removeCartItem`
  // возвращает `Promise<void>`, TanStack выводит `TData` сам из `mutationFn`); тип результата
  // всё равно зафиксирован сигнатурой функции (`UseCartMutationsResult['removeItem']`).
  return useMutation<Awaited<ReturnType<typeof removeCartItem>>, HttpError, string, OptimisticContext>({
    mutationFn: removeCartItem,
    onMutate: async (cartItemId) => {
      await queryClient.cancelQueries({ queryKey: CART_QUERY_KEY })
      const previous = queryClient.getQueryData<CartView>(CART_QUERY_KEY)
      if (previous !== undefined) {
        queryClient.setQueryData<CartView>(CART_QUERY_KEY, removeCartItemLocally(previous, cartItemId))
      }
      return { previous }
    },
    onError: (_error, _cartItemId, context) => {
      rollbackOnError(queryClient, context)
    },
    onSettled: () => {
      invalidateCart(queryClient)
    },
  })
}

export function useCartMutations(): UseCartMutationsResult {
  const queryClient = useQueryClient()
  return {
    addItem: useAddItemMutation(queryClient),
    updateQuantity: useUpdateQuantityMutation(queryClient),
    removeItem: useRemoveItemMutation(queryClient),
  }
}
