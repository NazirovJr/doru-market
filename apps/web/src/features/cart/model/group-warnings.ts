import {
  CART_ITEM_WARNING_INSUFFICIENT_STOCK,
  type CartDuplicateSubstanceWarningDto,
  type CartInsufficientStockWarningDto,
} from '@dorutj/contracts'

/**
 * `group-warnings.ts` (DTJ-234, EP-09) — чистая функция группировки предупреждений корзины.
 * Без React, тестируется отдельно (`group-warnings.spec.ts`).
 *
 * **Расхождение с текстом тикета (раздел DISPUTED отчёта сдачи).** Тикет описывает группировку
 * «по `cartItemId`» для ОБОИХ типов предупреждений. Контракт (`@dorutj/contracts/orders.ts`,
 * сверено построчно) этого не позволяет буквально:
 *   - `CartInsufficientStockWarningDto` несёт `cartItemId` — группируется по нему корректно.
 *   - `CartDuplicateSubstanceWarningDto` несёт `existingMedicineId`/`newMedicineId`, БЕЗ
 *     `cartItemId` вообще — предупреждение о дубле вещества относится к ПАРЕ медикаментов в
 *     корзине, не к одной строке, группировка по `cartItemId` для него структурно невозможна.
 * Функция группирует `insufficient_stock` по `cartItemId` (как просит тикет) и ОТДЕЛЬНО
 * прокидывает `duplicate_substance` на уровень корзины (`cartLevel`), не привязывая к строке.
 *
 * Дополнительно: `GET /api/v1/cart` (`GetCartUseCase`/`cart-view.mapper.ts`, DTJ-225/226,
 * прочитаны целиком) физически возвращает `meta.warnings: CartInsufficientStockWarningDto[]` —
 * `duplicate_substance` в этом массиве появиться НЕ МОЖЕТ (тип поля уже это исключает).
 * `duplicate_substance` приходит ТОЛЬКО в ответе `POST /cart/items` (`AddCartItemResult.warnings`,
 * `cart.api.ts`) — сиюминутный сигнал одной мутации, не персистентная часть корзины. Эта функция
 * остаётся типобезопасно общей для обоих источников (принимает объединение), чтобы
 * `CartWarningBanner` не переопределяла логику дважды под каждый источник.
 */

export type CartWarning = CartInsufficientStockWarningDto | CartDuplicateSubstanceWarningDto

export interface GroupedCartWarnings {
  readonly byCartItemId: ReadonlyMap<string, readonly CartInsufficientStockWarningDto[]>
  readonly cartLevel: readonly CartDuplicateSubstanceWarningDto[]
}

export function groupCartWarnings(warnings: readonly CartWarning[]): GroupedCartWarnings {
  const byCartItemId = new Map<string, CartInsufficientStockWarningDto[]>()
  const cartLevel: CartDuplicateSubstanceWarningDto[] = []

  for (const warning of warnings) {
    if (warning.type === CART_ITEM_WARNING_INSUFFICIENT_STOCK) {
      const existing = byCartItemId.get(warning.cartItemId) ?? []
      byCartItemId.set(warning.cartItemId, [...existing, warning])
      continue
    }
    // Единственный оставшийся член объединения `CartWarning` после исключения `insufficient_stock`
    // выше — `duplicate_substance` (`CART_WARNING_DUPLICATE_SUBSTANCE`), TS сужает тип сам;
    // явная повторная проверка типа была бы `@typescript-eslint/no-unnecessary-condition`.
    cartLevel.push(warning)
  }

  return { byCartItemId, cartLevel }
}
