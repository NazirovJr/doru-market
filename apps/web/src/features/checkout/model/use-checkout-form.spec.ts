import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useCheckoutForm } from './use-checkout-form'

/**
 * `use-checkout-form.spec.ts` (DTJ-235, тест-план: «состояние формы... двойной клик → один
 * запрос», DoD: «`Idempotency-Key` генерируется один раз на попытку... явно протестировано»
 * — здесь тестируется сигнал `onFormDataChanged`, который `checkout-screen.tsx` подключает к
 * `useCreateOrder().invalidateIdempotencyKey`; сама генерация ключа — `use-create-order.spec.ts`).
 */
describe('useCheckoutForm', () => {
  it('does NOT call onFormDataChanged on the initial render', () => {
    const onFormDataChanged = vi.fn()
    renderHook(() => useCheckoutForm(onFormDataChanged))
    expect(onFormDataChanged).not.toHaveBeenCalled()
  })

  it('calls onFormDataChanged when a field actually changes', () => {
    const onFormDataChanged = vi.fn()
    const { result } = renderHook(() => useCheckoutForm(onFormDataChanged))

    act(() => { result.current.setLandmark('у мечети') })

    expect(onFormDataChanged).toHaveBeenCalledTimes(1)
    expect(result.current.state.landmark).toBe('у мечети')
  })

  it('does NOT call onFormDataChanged for a no-op action (disabled payment method, AC4)', () => {
    const onFormDataChanged = vi.fn()
    const { result } = renderHook(() => useCheckoutForm(onFormDataChanged))

    act(() => { result.current.setPaymentMethod('alif_mobi') })

    expect(onFormDataChanged).not.toHaveBeenCalled()
    expect(result.current.state.paymentMethod).toBe('cash_courier')
  })

  it('trySubmit: first call returns true and sets isSubmitting; second call (double-click) returns false', () => {
    const { result } = renderHook(() => useCheckoutForm(vi.fn()))

    let first = false
    let second = false
    act(() => {
      first = result.current.trySubmit()
      // Двойной клик — второй вызов ДО того, как React успел бы что-либо перерисовать
      // (SRS-UX-050/TC-UX-004): мьютекс — `useRef`, поэтому оба вызова видят актуальное
      // значение синхронно, без ожидания ре-рендера между ними.
      second = result.current.trySubmit()
    })

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(result.current.isSubmitting).toBe(true)
  })

  it('finishSubmit releases the lock — a subsequent trySubmit() call succeeds again (retry after failure)', () => {
    const { result } = renderHook(() => useCheckoutForm(vi.fn()))

    act(() => { result.current.trySubmit() })
    act(() => { result.current.finishSubmit() })

    expect(result.current.isSubmitting).toBe(false)

    let retried = false
    act(() => { retried = result.current.trySubmit() })
    expect(retried).toBe(true)
  })
})
