import type { CartPharmacyGroupDto } from '@dorutj/contracts'
import type { CartView } from '../api/cart.api'

/**
 * `optimistic-cart-update.ts` (DTJ-234, EP-09) — чистые функции пересчёта локального снимка
 * корзины (`use-cart-mutations.ts`, `onMutate`) без похода на сервер: `updateQuantity`/
 * `removeItem` знают ЖИВУЮ цену затрагиваемой строки (`CartItemResponseDto.priceDiram`) уже из
 * закэшированного `GET /cart`, поэтому подытог аптечной группы можно скорректировать ТОЧНОЙ
 * целочисленной разницей (`priceDiram * quantityDelta`, дирамы — правило 6 AGENTS.md, никакого
 * `float`), не переоткрывая доменную логику группировки/цены сервера (`SplitCartByPharmacyUseCase`).
 *
 * `addItem` намеренно БЕЗ оптимистичного пути (`use-cart-mutations.ts`) — на клиенте нет живой
 * цены/остатка добавляемого медикамента (только `medicineId`/`pharmacyId`/`quantity` из формы),
 * соптимистично вставленная строка либо показала бы неверную цену, либо потребовала
 * дополнительного похода в каталог здесь же — вместо этого просто ждём ответ сервера.
 *
 * Инвалидация `use-cart-mutations.ts` (`invalidateQueries`) — источник истины ПОСЛЕ ответа
 * сервера; функции этого файла нужны ТОЛЬКО для отклика без мигания между запросом и ответом.
 */

/**
 * `nextQuantity <= 0` — тот же контракт, что бэкенд (`UpdateCartItemQuantityUseCase`, SRS-ORD-013):
 * эквивалентно удалению строки. Отсутствующий `cartItemId` в снимке — no-op (сервер лучше знает,
 * `onSettled` подтянет актуальное состояние).
 */
export function applyCartItemQuantityLocally(
  cart: CartView,
  cartItemId: string,
  nextQuantity: number,
): CartView {
  const target = cart.items.find((item) => item.id === cartItemId)
  if (target === undefined) {
    return cart
  }

  const isRemoval = nextQuantity <= 0
  const items = isRemoval
    ? cart.items.filter((item) => item.id !== cartItemId)
    : cart.items.map((item) => (item.id === cartItemId ? { ...item, quantity: nextQuantity } : item))

  const subtotalDeltaDiram = target.priceDiram * (nextQuantity - target.quantity)
  const pharmacyHasRemainingItems = items.some((item) => item.pharmacyId === target.pharmacyId)
  const pharmacyGroups = adjustPharmacyGroups(cart.pharmacyGroups, {
    pharmacyId: target.pharmacyId,
    subtotalDeltaDiram,
    keepEmptyGroup: pharmacyHasRemainingItems,
  })
  const warnings = isRemoval
    ? cart.warnings.filter((warning) => warning.cartItemId !== cartItemId)
    : cart.warnings

  return { items, pharmacyGroups, warnings }
}

export function removeCartItemLocally(cart: CartView, cartItemId: string): CartView {
  return applyCartItemQuantityLocally(cart, cartItemId, 0)
}

interface PharmacyGroupAdjustment {
  readonly pharmacyId: string
  readonly subtotalDeltaDiram: number
  readonly keepEmptyGroup: boolean
}

/** Object-параметр (C5, `max-params` ≤3) — 3 значения об ОДНОЙ корректируемой группе свёрнуты. */
function adjustPharmacyGroups(
  groups: readonly CartPharmacyGroupDto[],
  adjustment: PharmacyGroupAdjustment,
): readonly CartPharmacyGroupDto[] {
  return groups
    .map((group) =>
      group.pharmacyId === adjustment.pharmacyId
        ? { ...group, subtotalDiram: group.subtotalDiram + adjustment.subtotalDeltaDiram }
        : group,
    )
    .filter((group) => group.pharmacyId !== adjustment.pharmacyId || adjustment.keepEmptyGroup)
}
