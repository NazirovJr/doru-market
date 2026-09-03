import type { ReactElement } from 'react'
import { CART_WARNING_DUPLICATE_SUBSTANCE, type CartDuplicateSubstanceWarningDto } from '@dorutj/contracts'
import type { TranslateFunction } from '@dorutj/i18n'
import type { CartWarning } from '../model/group-warnings'

/**
 * `cart-warning-banner.tsx` (DTJ-234, «Что сделать» §4) — рендер предупреждений корзины по типу:
 * красный баннер для `duplicate_substance` (`role="alert"`), менее критичный (нейтральный) стиль
 * для `insufficient_stock` (`role="status"`) — оба текста ТОЛЬКО из `packages/i18n`
 * (`ux.warning.*`, канонические ключи 30-ux §5/новый ключ, не дословный текст дизайн-референса).
 *
 * `resolveDuplicateSubstanceLabel` (доработка DTJ-234, дефект приёмки) — `CartDuplicateSubstance
 * WarningDto.substanceNames` теперь несёт человекочитаемые названия ПЕРЕСЕКШИХСЯ веществ
 * (бэкенд, `AddCartItemUseCase`/`catalog-facade.adapter.ts`, прочитано целиком) — `ux.warning.
 * duplicate_substance` получает их напрямую, id больше НЕ подставляется. GET /api/v1/cart
 * сегодня физически не может вернуть такое предупреждение в `meta.warnings` (тип поля это
 * исключает) — этот путь рендера сегодня достижим только из ответа `POST /cart/items`
 * (`useCartMutations().addItem`), у которого в этом тикете нет UI-вызывающего кода (см. JSDoc
 * `use-cart-mutations.ts`).
 */
function resolveDuplicateSubstanceLabel(warning: CartDuplicateSubstanceWarningDto): string {
  return warning.substanceNames.join(', ')
}

export interface CartWarningBannerProps {
  readonly warnings: readonly CartWarning[]
  readonly t: TranslateFunction
}

export const CartWarningBanner = ({ warnings, t }: CartWarningBannerProps): ReactElement | null => {
  if (warnings.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-2" data-testid="cart-warning-banner">
      {warnings.map((warning) =>
        warning.type === CART_WARNING_DUPLICATE_SUBSTANCE ? (
          <p
            key={`duplicate-${warning.existingMedicineId}-${warning.newMedicineId}`}
            role="alert"
            data-testid="cart-warning-duplicate-substance"
            className="rounded-md border border-brand-danger bg-brand-danger/10 p-3 text-sm text-brand-danger"
          >
            {t('ux.warning.duplicate_substance', { substanceNames: resolveDuplicateSubstanceLabel(warning) })}
          </p>
        ) : (
          <p
            key={`stock-${warning.cartItemId}`}
            role="status"
            data-testid="cart-warning-insufficient-stock"
            className="rounded-md border border-line bg-surface p-3 text-sm text-ink-muted"
          >
            {t('ux.warning.insufficient_stock', { availableQuantity: warning.availableQuantity })}
          </p>
        ),
      )}
    </div>
  )
}
