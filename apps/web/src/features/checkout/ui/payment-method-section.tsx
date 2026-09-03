import type { ReactElement } from 'react'
import type { OrderPaymentMethod } from '@dorutj/contracts'
import type { TranslateFunction } from '@dorutj/i18n'
import { ENABLED_PAYMENT_METHODS_R1 } from '../model/checkout-form.model'

/**
 * `payment-method-section.tsx` (DTJ-235, «Что сделать» §4, AC4) — радио-список способов оплаты.
 *
 * R1: `cash_courier` — единственный активный, `alif_mobi`/`dc_next` — задизейблены с бейджем
 * «Скоро» (D-16/D-25). `disabled`-атрибут кнопки — ПЕРВЫЙ рубеж защиты («клик по ним ничего не
 * отправляет», AC4): физически задизейбленный `<button>` не порождает `onClick`. ВТОРОЙ рубеж —
 * `checkoutFormReducer` (`checkout-form.model.ts`) отбрасывает `set_payment_method` для
 * НЕ входящего в `ENABLED_PAYMENT_METHODS_R1` метода, даже если бы обработчик клика всё же
 * вызвался (defense in depth на уровне чистой функции, не только DOM).
 *
 * Ярлыки способов оплаты — по ключам `checkout.payment.<method>` (i18n, `packages/i18n`),
 * порядок enum'а `ORDER_PAYMENT_METHOD_VALUES` (`@dorutj/contracts`) НЕ используется для
 * порядка отображения (наличные обязаны идти первыми, дизайн-референт `.dc.html:914-928`) —
 * `DISPLAY_ORDER` ниже фиксирует порядок явно.
 */

const DISPLAY_ORDER: readonly OrderPaymentMethod[] = ['cash_courier', 'dc_next', 'alif_mobi']

function isEnabled(method: OrderPaymentMethod): boolean {
  return ENABLED_PAYMENT_METHODS_R1.includes(method)
}

interface PaymentMethodOptionProps {
  readonly method: OrderPaymentMethod
  readonly selected: boolean
  readonly onSelect: (method: OrderPaymentMethod) => void
  readonly t: TranslateFunction
}

const PaymentMethodOption = ({ method, selected, onSelect, t }: PaymentMethodOptionProps): ReactElement => {
  const enabled = isEnabled(method)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!enabled}
      data-testid={`checkout-payment-method-${method}`}
      onClick={() => { onSelect(method) }}
      className={`flex min-h-12 items-center gap-3 rounded-md border p-3 text-left ${
        selected ? 'border-brand-primary bg-surface' : 'border-line'
      } ${enabled ? '' : 'opacity-50'}`}
    >
      <span
        aria-hidden="true"
        className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${selected ? 'border-brand-primary' : 'border-line'}`}
      />
      <span className="flex-1 text-sm font-medium text-ink">{t(`checkout.payment.${method}`)}</span>
      {enabled ? null : (
        <span
          data-testid={`checkout-payment-method-${method}-badge`}
          className="rounded-full bg-surface px-2 py-1 text-xs font-semibold text-ink-muted"
        >
          {t('checkout.payment.coming_soon')}
        </span>
      )}
    </button>
  )
}

export interface PaymentMethodSectionProps {
  readonly selected: OrderPaymentMethod
  readonly onSelect: (method: OrderPaymentMethod) => void
  readonly t: TranslateFunction
}

export const PaymentMethodSection = ({ selected, onSelect, t }: PaymentMethodSectionProps): ReactElement => (
  <section data-testid="checkout-payment-method-section">
    <h2 className="mb-2 text-sm font-semibold text-ink">{t('checkout.payment.title')}</h2>
    <div role="radiogroup" aria-label={t('checkout.payment.title')} className="flex flex-col gap-2">
      {DISPLAY_ORDER.map((method) => (
        <PaymentMethodOption key={method} method={method} selected={selected === method} onSelect={onSelect} t={t} />
      ))}
    </div>
  </section>
)
