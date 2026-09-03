import { useCallback, type ReactElement } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import type { CartPharmacyGroupDto } from '@dorutj/contracts'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import type { HttpError } from '@/shared/api/http-client'
import { useCheckoutCart } from '../api/use-checkout-cart'
import { useCreateOrder } from '../api/use-create-order'
import { useCheckoutForm } from '../model/use-checkout-form'
import { buildCreateOrderInput } from '../model/build-create-order-input'
import { OrderSummarySection } from './order-summary-section'
import { AddressPickerSection, type SavedAddressOption } from './address-picker-section'
import { PaymentMethodSection } from './payment-method-section'
import { CheckoutResultSection } from './checkout-result-section'

/**
 * `checkout-screen.tsx` (DTJ-235, EP-09, `SRS-UX-050/051/052/054`) — композиция: сводка по
 * аптекам (`OrderSummarySection`) + адрес (`AddressPickerSection`) + оплата
 * (`PaymentMethodSection`) + кнопка «Оформить заказ», либо результат (`CheckoutResultSection`)
 * после ответа сервера.
 *
 * **Гейт аутентификации.** `POST /orders` требует `@Roles('customer')` — гость физически не
 * может оформить заказ. Без `ProtectedRoute`/route-guard в `apps/web/src/app/router.tsx`
 * (проверено — такого компонента в проекте нет нигде, найденная чужая проблема, см. отчёт
 * сдачи) гость МОГ БЫ открыть `/checkout` напрямую по URL; этот экран сам проверяет
 * `useAuthStore().accessToken` и не рендерит форму/не шлёт `GET /cart` без него — тот же эффект,
 * что полноценный guard дал бы для ЭТОГО экрана конкретно (не общее решение для всех защищённых
 * маршрутов — вне периметра тикета).
 *
 * **SRS-UX-051 (гонка WS/`order.paid`) — без кода.** В `apps/web` сегодня нет ни одного
 * WS-клиента (`WebSocket`/`socket.io`/`useWs` — ноль совпадений по всему `src/`, проверено
 * `grep`) — подключать обработчик гонки не к чему. Тикет сам разрешает это явно («если ещё
 * нет — TODO, не блокирует тикет») — заготовка-функция без единого вызывающего места была бы
 * мёртвым кодом (правило 2 AGENTS.md), поэтому не заведена; см. БЛОКЕРЫ отчёта сдачи.
 */

const SAVED_ADDRESSES: readonly SavedAddressOption[] = [] // см. JSDoc address-picker-section.tsx

function buildPharmacyNameById(groups: readonly CartPharmacyGroupDto[]): ReadonlyMap<string, string | null> {
  return new Map(groups.map((group) => [group.pharmacyId, group.pharmacyName]))
}

const CheckoutUnauthenticated = ({ t, onLogin }: { readonly t: TranslateFunction; readonly onLogin: () => void }): ReactElement => (
  <div className="flex flex-col items-center gap-4 p-8 text-center" data-testid="checkout-unauthenticated">
    <p className="text-sm text-ink-muted">{t('checkout.unauthenticated_message')}</p>
    <button
      type="button"
      data-testid="checkout-login-cta"
      onClick={onLogin}
      className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-6 font-semibold text-white"
    >
      {t('checkout.unauthenticated_cta')}
    </button>
  </div>
)

const CheckoutLoading = ({ t }: { readonly t: TranslateFunction }): ReactElement => (
  <p role="status" data-testid="checkout-loading" className="p-4 text-center text-sm text-ink-muted">
    {t('checkout.loading')}
  </p>
)

const CheckoutLoadError = ({ t, onRetry }: { readonly t: TranslateFunction; readonly onRetry: () => void }): ReactElement => (
  <div role="alert" data-testid="checkout-load-error" className="flex flex-col items-center gap-2 p-4 text-center text-sm text-ink">
    <p>{t('ux.error.generic_500')}</p>
    <button
      type="button"
      data-testid="checkout-load-retry"
      onClick={onRetry}
      className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-3 font-semibold text-white"
    >
      {t('ux.action.retry')}
    </button>
  </div>
)

const CheckoutEmptyCart = ({ t, onBrowse }: { readonly t: TranslateFunction; readonly onBrowse: () => void }): ReactElement => (
  <div className="flex flex-col items-center gap-4 p-8 text-center" data-testid="checkout-empty-cart">
    <p className="text-sm text-ink-muted">{t('checkout.empty_cart')}</p>
    <button
      type="button"
      data-testid="checkout-empty-cart-cta"
      onClick={onBrowse}
      className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-6 font-semibold text-white"
    >
      {t('cart.empty_cta')}
    </button>
  </div>
)

const SubmitErrorBanner = ({ error, t }: { readonly error: HttpError | null; readonly t: TranslateFunction }): ReactElement | null =>
  error === null ? null : (
    <p role="alert" data-testid="checkout-submit-error" className="text-sm text-brand-danger">
      {t('ux.error.generic_500')}
    </p>
  )

function useCheckoutNavigation(navigate: NavigateFunction): { readonly goHome: () => void; readonly goLogin: () => void } {
  const goHome = useCallback(() => { void navigate('/') }, [navigate])
  const goLogin = useCallback(() => { void navigate('/login') }, [navigate])
  return { goHome, goLogin }
}

export const CheckoutScreen = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()
  const { goHome, goLogin } = useCheckoutNavigation(navigate)

  const isAuthenticated = useAuthStore((authState) => authState.accessToken !== null)
  const cartQuery = useCheckoutCart(isAuthenticated)
  const createOrder = useCreateOrder()
  const form = useCheckoutForm(createOrder.invalidateIdempotencyKey)

  const handleRetry = useCallback(() => { void cartQuery.refetch() }, [cartQuery])

  const handleSubmit = useCallback(() => {
    if (!form.isValid || cartQuery.data === undefined) {
      return
    }
    // SRS-UX-050/AC1: мьютекс синхронный — второй быстрый клик видит `false` и не доходит до
    // `createOrder.submit`, поэтому ровно ОДИН `POST /orders` уходит в сеть на попытку.
    if (!form.trySubmit()) {
      return
    }
    const cartItemIds = cartQuery.data.items.map((item) => item.id)
    const input = buildCreateOrderInput({ state: form.state, cartItemIds, pharmacyGroups: cartQuery.data.pharmacyGroups }, t)
    if (input === null) {
      form.finishSubmit()
      return
    }
    createOrder.submit(input, { onSettled: form.finishSubmit })
  }, [form, cartQuery.data, createOrder, t])

  if (!isAuthenticated) {
    return <CheckoutUnauthenticated t={t} onLogin={goLogin} />
  }
  if (cartQuery.isPending) {
    return <CheckoutLoading t={t} />
  }
  if (cartQuery.error !== null) {
    return <CheckoutLoadError t={t} onRetry={handleRetry} />
  }
  if (cartQuery.data.items.length === 0 && createOrder.data === undefined) {
    return <CheckoutEmptyCart t={t} onBrowse={goHome} />
  }
  if (createOrder.data !== undefined) {
    return (
      <CheckoutResultSection
        result={createOrder.data}
        pharmacyNameById={buildPharmacyNameById(cartQuery.data.pharmacyGroups)}
        locale={locale}
        onContinue={goHome}
        t={t}
      />
    )
  }

  return (
    <section className="flex flex-col gap-6" data-testid="checkout-screen">
      <h1 className="text-lg font-bold text-ink">{t('checkout.title')}</h1>
      <OrderSummarySection pharmacyGroups={cartQuery.data.pharmacyGroups} locale={locale} t={t} />
      <AddressPickerSection
        state={form.state}
        validation={form.validation}
        savedAddresses={SAVED_ADDRESSES}
        onSelectSavedAddress={form.selectSavedAddress}
        onSwitchToInlineAddress={form.switchToInlineAddress}
        onAddressTextChange={form.setInlineAddressText}
        onCoordinatesPick={form.setInlineCoordinates}
        onLandmarkChange={form.setLandmark}
        onEntranceChange={form.setEntrance}
        onFloorChange={form.setFloor}
        onApartmentChange={form.setApartment}
        t={t}
      />
      <PaymentMethodSection selected={form.state.paymentMethod} onSelect={form.setPaymentMethod} t={t} />
      <SubmitErrorBanner error={createOrder.error} t={t} />
      <button
        type="button"
        data-testid="checkout-submit-cta"
        disabled={!form.isValid || form.isSubmitting}
        onClick={handleSubmit}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-brand-primary px-6 font-semibold text-white disabled:opacity-40"
      >
        {form.isSubmitting ? (
          <span
            aria-hidden="true"
            data-testid="checkout-submit-spinner"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        ) : null}
        {form.isSubmitting ? t('checkout.submit_pending') : t('checkout.submit_cta')}
      </button>
    </section>
  )
}
