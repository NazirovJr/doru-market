import type { ReactElement } from 'react'
import type { CartItemResponseDto } from '@dorutj/contracts'
import type { TranslateFunction } from '@dorutj/i18n'

/**
 * `pharmacy-group-card.tsx` (DTJ-234, «Что сделать» §3) — одна карточка-группа по аптеке:
 * название, позиции, подытог, кнопка удаления и степпер количества на позицию.
 *
 * **Источник строк — НЕ `meta.pharmacyGroups[].items[]`.** Тот массив (`CartPharmacyGroupItemDto`,
 * `@dorutj/contracts`, сверено построчно) несёт `medicineId`/`pharmacyId`/`quantity`/
 * `unitPriceDiram`, но БЕЗ `id` строки корзины — `DELETE /cart/items/:id`/`PATCH .../:id` не на
 * что ссылаться. Рабочий `id` есть только в плоском `CartViewResponseDto.items[]`
 * (`CartItemResponseDto`) — карточка получает СВОИ строки уже отфильтрованными по `pharmacyId`
 * из этого массива (`cart-screen.tsx`), а `pharmacyName`/`subtotalDiram` — из `meta.pharmacyGroups`
 * (сервер уже посчитал сумму, дублировать эту арифметику здесь не нужно).
 *
 * **`medicineTradeName` (доработка DTJ-234, дефект приёмки, ранее рендерился `medicineId`).**
 * `CartItemResponseDto.medicineTradeName` — ОБЯЗАТЕЛЬНОЕ поле (`medicines.trade_name`, `NOT
 * NULL`), прокинуто через `MedicineOrderSnapshot`/`GetCartUseCase`/`cart-view.mapper.ts` —
 * see `apps/api/.../ports/catalog-facade.port.ts`. UUID `medicineId` больше НЕ рендерится.
 *
 * Тап-зоны ≥48×48px (SRS-UX-002) — `min-h-12 min-w-12` (Tailwind-шкала: `12` = 3rem = 48px)
 * на каждой кнопке, hit-slop через padding/центрирование содержимого, не через раздувание
 * видимого символа (`−`/`+`/`×` остаются обычного размера внутри увеличенной тап-зоны).
 */

const DIRAM_PER_SOMONI = 100
const MIN_QUANTITY = 1
const TAP_ZONE_CLASS = 'inline-flex min-h-12 min-w-12 items-center justify-center rounded-md text-base'

function formatSomoni(priceDiram: number): string {
  return (priceDiram / DIRAM_PER_SOMONI).toFixed(2)
}

interface CartItemRowProps {
  readonly item: CartItemResponseDto
  readonly hasStockWarning: boolean
  readonly onRemove: (cartItemId: string) => void
  readonly onQuantityChange: (cartItemId: string, quantity: number) => void
  readonly t: TranslateFunction
}

/**
 * `hasStockWarning` — из `group-warnings.ts` (`GroupedCartWarnings.byCartItemId`), прокинуто
 * `cart-screen.tsx`: визуально указывает, КАКАЯ ИМЕННО строка внутри (возможно, длинной) группы
 * задета `insufficient_stock`, ДОПОЛНЯЯ (не дублируя текстом) сводный список в
 * `CartWarningBanner` — банер объясняет ЧТО произошло, подсветка строки — ГДЕ именно.
 */
const CartItemRow = ({
  item,
  hasStockWarning,
  onRemove,
  onQuantityChange,
  t,
}: CartItemRowProps): ReactElement => {
  const canDecrease = item.quantity > MIN_QUANTITY
  return (
    <li
      className={`flex items-center justify-between gap-2 py-2 ${hasStockWarning ? 'border-l-2 border-brand-danger pl-2' : ''}`}
      data-testid="cart-item-row"
      data-cart-item-id={item.id}
      data-has-stock-warning={hasStockWarning}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-ink" data-testid="cart-item-medicine-name">
          {item.medicineTradeName}
        </span>
        <span className="text-xs text-ink-muted" data-testid="cart-item-price">
          {t('catalog.search.price', { price: formatSomoni(item.priceDiram) })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t('cart.quantity_decrease')}
          data-testid="cart-item-decrease"
          disabled={!canDecrease}
          onClick={() => {
            onQuantityChange(item.id, item.quantity - 1)
          }}
          className={`${TAP_ZONE_CLASS} border border-line text-ink disabled:opacity-40`}
        >
          −
        </button>
        <span className="w-6 text-center text-sm text-ink" data-testid="cart-item-quantity">
          {item.quantity}
        </span>
        <button
          type="button"
          aria-label={t('cart.quantity_increase')}
          data-testid="cart-item-increase"
          onClick={() => {
            onQuantityChange(item.id, item.quantity + 1)
          }}
          className={`${TAP_ZONE_CLASS} border border-line text-ink`}
        >
          +
        </button>
        <button
          type="button"
          aria-label={t('cart.remove_item')}
          data-testid="cart-item-remove"
          onClick={() => {
            onRemove(item.id)
          }}
          className={`${TAP_ZONE_CLASS} text-brand-danger`}
        >
          ×
        </button>
      </div>
    </li>
  )
}

export interface PharmacyGroupCardProps {
  readonly pharmacyId: string
  readonly pharmacyName: string | null
  readonly subtotalDiram: number
  readonly items: readonly CartItemResponseDto[]
  /** `group-warnings.ts#GroupedCartWarnings.byCartItemId` — см. JSDoc `CartItemRow`. */
  readonly warningCartItemIds: ReadonlySet<string>
  readonly onRemove: (cartItemId: string) => void
  readonly onQuantityChange: (cartItemId: string, quantity: number) => void
  readonly t: TranslateFunction
}

export const PharmacyGroupCard = ({
  pharmacyId,
  pharmacyName,
  subtotalDiram,
  items,
  warningCartItemIds,
  onRemove,
  onQuantityChange,
  t,
}: PharmacyGroupCardProps): ReactElement => (
  <section
    className="rounded-md border border-line bg-surface p-3"
    data-testid="pharmacy-group-card"
    data-pharmacy-id={pharmacyId}
  >
    <h3 className="text-sm font-semibold text-ink" data-testid="pharmacy-group-name">
      {pharmacyName ?? t('cart.pharmacy_unknown_name')}
    </h3>
    <ul className="divide-y divide-line" data-testid="pharmacy-group-items">
      {items.map((item) => (
        <CartItemRow
          key={item.id}
          item={item}
          hasStockWarning={warningCartItemIds.has(item.id)}
          onRemove={onRemove}
          onQuantityChange={onQuantityChange}
          t={t}
        />
      ))}
    </ul>
    <p className="mt-2 text-right text-sm font-semibold text-ink" data-testid="pharmacy-group-subtotal">
      {t('cart.pharmacy_subtotal', { amount: formatSomoni(subtotalDiram) })}
    </p>
  </section>
)
