import { useCallback, type ReactElement } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { ErrorCode, type CartItemResponseDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import type { HttpError } from '@/shared/api/http-client'
import { useCart } from '../api/use-cart'
import { useCartMutations, type UseCartMutationsResult } from '../api/use-cart-mutations'
import type { CartView } from '../api/cart.api'
import { groupCartWarnings } from '../model/group-warnings'
import { CartWarningBanner } from './cart-warning-banner'
import { PharmacyGroupCard } from './pharmacy-group-card'
import { EmptyState } from './empty-state'

/**
 * `cart-screen.tsx` (DTJ-234, EP-09, `SRS-UX-002/045/046`, `SRS-ORD-002/005/010/012`) —
 * `GET /api/v1/cart` (`?extendHold=true`, SRS-ORD-005) → группы по аптекам + предупреждения +
 * CTA «Перейти к оформлению» (переход в `/checkout`, DTJ-235, вне периметра этого тикета).
 *
 * TWA/`MainButton` (тикет «Что сделать» §8, `SRS-UX-045/046`): `packages/ui` ещё не несёт
 * `useMainButton`/`isTwaRuntime` (EP-18, DTJ-411 «Реализовать слой темизации и хуков Telegram
 * Mini App», `packages/ui/src/index.ts` пуст — проверено) — по умолчанию рендерим обычную
 * кнопку. TODO(DTJ-411): при готовности хука — не рендерить обычную кнопку дублирующе, когда
 * TWA-режим активен (проверка через `isTwaRuntime()`), передать `disabled` в `useMainButton`.
 *
 * CTA `disabled` при непустых `warnings` (`docs/spec/30-ux-screens-and-flows.md` строка 817:
 * «`/cart` → "Оформить заказ" → нет неразрешённых `insufficient_stock`-предупреждений»,
 * согласовано со строкой 487 «checkout не блокируется ПОЛНОСТЬЮ» — блокируется только сам CTA,
 * не весь экран: пользователь по-прежнему может скорректировать количество через степпер).
 *
 * Декомпозиция файла на мелкие компоненты (`CartLoading`/`CartError`/`CartSplitBanner`/
 * `CartMutationErrorBanner`/`CartCheckoutCta`/`CartReadyContent`) — C1 (`max-lines-per-function`
 * ≤40) и DoD тикета «Компонент ≤150 строк»; тот же приём, что `map-page.tsx` (`MapPageBanner`
 * в одном файле со страницей).
 */

const MIN_QUANTITY = 1

function itemsForPharmacy(
  items: readonly CartItemResponseDto[],
  pharmacyId: string,
): readonly CartItemResponseDto[] {
  return items.filter((item) => item.pharmacyId === pharmacyId)
}

/** Ticket «Коды ошибок, которые обязан обработать UI»: `VALIDATION_ERROR` → `details.issues`
 *  (конкретное поле), не общий тост. Остальные коды — общее сообщение (`ux.error.generic_500`,
 *  500 намеренно замаскирован сервером, JSDoc тикета). */
function resolveMutationErrorMessage(error: HttpError, t: TranslateFunction): string {
  // `HttpError.code` — намеренно `string` (сервер может прислать любой код, не только
  // известный `ErrorCode`) — сравнение с явным `as string` на стороне enum, иначе
  // `@typescript-eslint/no-unsafe-enum-comparison` (обе стороны разного типа).
  if (error.code === (ErrorCode.VALIDATION_ERROR as string)) {
    const details = error.details
    const issues =
      typeof details === 'object' && details !== null
        ? (details as { readonly issues?: unknown }).issues
        : undefined
    const firstIssue = Array.isArray(issues)
      ? (issues[0] as { readonly message?: unknown } | undefined)
      : undefined
    if (typeof firstIssue?.message === 'string') {
      return firstIssue.message
    }
  }
  return t('ux.error.generic_500')
}

interface CartActions {
  readonly onFindMedicine: () => void
  readonly onCheckout: () => void
  readonly onRemove: (cartItemId: string) => void
  readonly onQuantityChange: (cartItemId: string, quantity: number) => void
}

function useCartScreenActions(
  navigate: NavigateFunction,
  removeItem: UseCartMutationsResult['removeItem'],
  updateQuantity: UseCartMutationsResult['updateQuantity'],
): CartActions {
  // Тело в фигурных скобках у всех трёх — `NavigateFunction`/`mutate` возвращают `void | Promise<void>`
  // (react-router v7) — присвоение промиса туда, где интерфейс `CartActions` ждёт `() => void`,
  // ловит `@typescript-eslint/no-misused-promises`; явный блок отбрасывает возврат.
  const onFindMedicine = useCallback(() => {
    void navigate('/')
  }, [navigate])
  const onCheckout = useCallback(() => {
    void navigate('/checkout')
  }, [navigate])
  const onRemove = useCallback(
    (cartItemId: string) => {
      removeItem.mutate(cartItemId)
    },
    [removeItem],
  )
  const onQuantityChange = useCallback(
    (cartItemId: string, quantity: number) => {
      if (quantity >= MIN_QUANTITY) {
        updateQuantity.mutate({ cartItemId, quantity })
      }
    },
    [updateQuantity],
  )
  return { onFindMedicine, onCheckout, onRemove, onQuantityChange }
}

const CartLoading = ({ t }: { readonly t: TranslateFunction }): ReactElement => (
  <p role="status" data-testid="cart-loading" className="p-4 text-center text-sm text-ink-muted">
    {t('cart.loading')}
  </p>
)

const CartError = ({
  t,
  onRetry,
}: {
  readonly t: TranslateFunction
  readonly onRetry: () => void
}): ReactElement => (
  <div
    role="alert"
    data-testid="cart-error"
    className="flex flex-col items-center gap-2 p-4 text-center text-sm text-ink"
  >
    <p>{t('ux.error.generic_500')}</p>
    <button
      type="button"
      data-testid="cart-retry"
      onClick={onRetry}
      className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-3 font-semibold text-white"
    >
      {t('ux.action.retry')}
    </button>
  </div>
)

const CartSplitBanner = ({
  count,
  t,
}: {
  readonly count: number
  readonly t: TranslateFunction
}): ReactElement | null =>
  count > 1 ? (
    <p role="status" data-testid="cart-split-banner" className="rounded-md bg-surface p-3 text-sm text-ink">
      {t('cart.split_banner', { count })}
    </p>
  ) : null

const CartMutationErrorBanner = ({
  error,
  t,
}: {
  readonly error: HttpError | null
  readonly t: TranslateFunction
}): ReactElement | null =>
  error === null ? null : (
    <p role="alert" data-testid="cart-mutation-error" className="text-sm text-brand-danger">
      {resolveMutationErrorMessage(error, t)}
    </p>
  )

interface CartCheckoutCtaProps {
  readonly disabled: boolean
  readonly onClick: () => void
  readonly t: TranslateFunction
}

const CartCheckoutCta = ({ disabled, onClick, t }: CartCheckoutCtaProps): ReactElement => (
  <button
    type="button"
    data-testid="cart-checkout-cta"
    disabled={disabled}
    onClick={onClick}
    className="inline-flex min-h-12 w-fit items-center justify-center self-center rounded-md bg-brand-primary px-6 font-semibold text-white disabled:opacity-40"
  >
    {t('cart.checkout_cta')}
  </button>
)

interface CartReadyContentProps {
  readonly cart: CartView
  readonly mutationError: HttpError | null
  readonly actions: CartActions
  readonly t: TranslateFunction
}

const CartReadyContent = ({ cart, mutationError, actions, t }: CartReadyContentProps): ReactElement => {
  const grouped = groupCartWarnings(cart.warnings)
  const warningCartItemIds = new Set(grouped.byCartItemId.keys())
  return (
    <section className="flex flex-col gap-4" data-testid="cart-screen">
      <CartWarningBanner warnings={cart.warnings} t={t} />
      <CartSplitBanner count={cart.pharmacyGroups.length} t={t} />
      <CartMutationErrorBanner error={mutationError} t={t} />
      <div className="flex flex-col gap-3" data-testid="cart-pharmacy-groups">
        {cart.pharmacyGroups.map((group) => (
          <PharmacyGroupCard
            key={group.pharmacyId}
            pharmacyId={group.pharmacyId}
            pharmacyName={group.pharmacyName}
            subtotalDiram={group.subtotalDiram}
            items={itemsForPharmacy(cart.items, group.pharmacyId)}
            warningCartItemIds={warningCartItemIds}
            onRemove={actions.onRemove}
            onQuantityChange={actions.onQuantityChange}
            t={t}
          />
        ))}
      </div>
      <CartCheckoutCta disabled={cart.warnings.length > 0} onClick={actions.onCheckout} t={t} />
    </section>
  )
}

export const CartScreen = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()
  const cartQuery = useCart({ extendHold: true })
  const { removeItem, updateQuantity } = useCartMutations()
  const actions = useCartScreenActions(navigate, removeItem, updateQuantity)
  const handleRetry = useCallback(() => {
    void cartQuery.refetch()
  }, [cartQuery])

  if (cartQuery.isPending) {
    return <CartLoading t={t} />
  }
  if (cartQuery.error !== null) {
    return <CartError t={t} onRetry={handleRetry} />
  }

  const cart = cartQuery.data
  if (cart.items.length === 0) {
    return (
      <EmptyState
        message={t('ux.empty.cart')}
        ctaLabel={t('cart.empty_cta')}
        onCtaClick={actions.onFindMedicine}
      />
    )
  }

  const mutationError = removeItem.error ?? updateQuantity.error ?? null
  return <CartReadyContent cart={cart} mutationError={mutationError} actions={actions} t={t} />
}
