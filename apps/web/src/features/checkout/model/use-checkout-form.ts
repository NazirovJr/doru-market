import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { OrderPaymentMethod } from '@dorutj/contracts'
import {
  checkoutFormReducer,
  createInitialCheckoutFormState,
  isCheckoutFormValid,
  validateCheckoutForm,
  type CheckoutFormState,
  type CheckoutFormValidation,
} from './checkout-form.model'

/**
 * `use-checkout-form.ts` (DTJ-235, «Что сделать» §5) — React-обвязка над `checkout-form.model.ts`:
 * `useReducer` для состояния полей + СИНХРОННЫЙ мьютекс двойного клика (`SRS-UX-050`/TC-UX-004).
 *
 * **Почему мьютекс — `useRef`, а не только `useState`.** Два быстрых вызова `trySubmit()` из
 * ОДНОГО обработчика клика (в т.ч. синтетический двойной клик в тесте — два `fireEvent.click`
 * подряд БЕЗ ре-рендера между ними) видят ОДНО И ТО ЖЕ замыкание над `useState`-значением
 * предыдущего рендера — React не гарантирует, что `setState` применится до второго вызова.
 * `useRef` читается/пишется синхронно, поэтому второй вызов ГАРАНТИРОВАННО видит `true`,
 * выставленный первым, ещё ДО того, как React вообще решит перерисовывать компонент — это и есть
 * «кнопка переходит в disabled/loading СИНХРОННО с первым кликом» из тикета, а не просто
 * оптимистичная надежда на своевременный ре-рендер. `isSubmitting`-state существует ПАРАЛЛЕЛЬНО
 * — он только для ВИЗУАЛЬНОГО состояния кнопки (спиннер/`disabled`-атрибут), не для защиты от
 * повторной отправки — защита целиком на `submitLockRef`.
 *
 * **`onFormDataChanged`** — вызывается через `useEffect(..., [state])`, ТОЛЬКО когда
 * `checkoutFormReducer` реально вернул НОВЫЙ объект состояния (не на первом монтировании и не на
 * действиях-no-op вроде клика по задизейбленному способу оплаты, см. JSDoc reducer'а —
 * `checkoutFormReducer` возвращает тот же `state` referentially, если действие ничего не меняет).
 * `checkout-screen.tsx` подключает сюда `useCreateOrder().invalidateIdempotencyKey`, реализуя
 * «новый Idempotency-Key только при явном изменении данных формы пользователем после провала»
 * (тикет «Что сделать» §1) БЕЗ того, чтобы эта модель знала о существовании `Idempotency-Key`
 * вообще (разделение ответственности: генерация ключа — `use-create-order.ts`, констатация факта
 * «форма изменилась» — здесь). Побочный эффект НЕ вызывается прямо внутри reducer'а (reducer
 * обязан оставаться чистым — React 18/19 Strict Mode может вызвать его дважды в dev), поэтому
 * связь идёт через `useEffect`, а не через side effect в `checkoutFormReducer`.
 */
export interface UseCheckoutFormResult {
  readonly state: CheckoutFormState
  readonly validation: CheckoutFormValidation
  readonly isValid: boolean
  readonly isSubmitting: boolean
  readonly selectSavedAddress: (addressId: string) => void
  readonly switchToInlineAddress: () => void
  readonly setInlineAddressText: (value: string) => void
  readonly setInlineCoordinates: (latitude: number, longitude: number) => void
  readonly setLandmark: (value: string) => void
  readonly setEntrance: (value: string) => void
  readonly setFloor: (value: string) => void
  readonly setApartment: (value: string) => void
  readonly setPaymentMethod: (method: OrderPaymentMethod) => void
  /** `SRS-UX-050`: `true` — вызывающий код МОЖЕТ продолжить отправку; `false` — уже идёт попытка,
   *  вызывающий код обязан ничего не делать (защита от двойного клика). */
  readonly trySubmit: () => boolean
  /** Вызывается из `onSettled` мутации `useCreateOrder` — снимает мьютекс. */
  readonly finishSubmit: () => void
}

export function useCheckoutForm(onFormDataChanged: () => void): UseCheckoutFormResult {
  const [state, dispatch] = useReducer(checkoutFormReducer, undefined, createInitialCheckoutFormState)

  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    onFormDataChanged()
    // `state` — намеренная единственная зависимость: эффект обязан сработать РОВНО на смену
    // объекта состояния (новую ссылку от reducer'а), не на смену идентичности колбэка
    // `onFormDataChanged` между рендерами родителя. `react-hooks/exhaustive-deps` не подключён в
    // этом проекте (`eslint.config.mjs`, проверено) — подавлять нечего.
  }, [state])

  const submitLockRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const trySubmit = useCallback((): boolean => {
    if (submitLockRef.current) {
      return false
    }
    submitLockRef.current = true
    setIsSubmitting(true)
    return true
  }, [])

  const finishSubmit = useCallback((): void => {
    submitLockRef.current = false
    setIsSubmitting(false)
  }, [])

  const validation = useMemo(() => validateCheckoutForm(state), [state])

  const selectSavedAddress = useCallback(
    (addressId: string) => { dispatch({ type: 'select_saved_address', addressId }) },
    [dispatch],
  )
  const switchToInlineAddress = useCallback(() => { dispatch({ type: 'switch_to_inline_address' }) }, [dispatch])
  const setInlineAddressText = useCallback(
    (value: string) => { dispatch({ type: 'set_inline_address_text', value }) },
    [dispatch],
  )
  const setInlineCoordinates = useCallback(
    (latitude: number, longitude: number) => { dispatch({ type: 'set_inline_coordinates', latitude, longitude }) },
    [dispatch],
  )
  const setLandmark = useCallback((value: string) => { dispatch({ type: 'set_landmark', value }) }, [dispatch])
  const setEntrance = useCallback((value: string) => { dispatch({ type: 'set_entrance', value }) }, [dispatch])
  const setFloor = useCallback((value: string) => { dispatch({ type: 'set_floor', value }) }, [dispatch])
  const setApartment = useCallback((value: string) => { dispatch({ type: 'set_apartment', value }) }, [dispatch])
  const setPaymentMethod = useCallback(
    (method: OrderPaymentMethod) => { dispatch({ type: 'set_payment_method', method }) },
    [dispatch],
  )

  return {
    state,
    validation,
    isValid: isCheckoutFormValid(validation),
    isSubmitting,
    selectSavedAddress,
    switchToInlineAddress,
    setInlineAddressText,
    setInlineCoordinates,
    setLandmark,
    setEntrance,
    setFloor,
    setApartment,
    setPaymentMethod,
    trySubmit,
    finishSubmit,
  }
}
