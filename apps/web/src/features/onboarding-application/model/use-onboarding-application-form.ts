import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import {
  createInitialOnboardingFormState,
  onboardingFormReducer,
  validateChainFields,
  validatePharmacyFields,
  type OnboardingFormErrors,
  type OnboardingFormState,
  type OnboardingTextField,
} from './onboarding-form.model'

/**
 * `use-onboarding-application-form.ts` (DTJ-076) — React-обвязка над `onboarding-form.model.ts`:
 * `useReducer` + СИНХРОННЫЙ мьютекс двойного клика (AC5, тот же приём `useRef`, что
 * `checkout/model/use-checkout-form.ts` — см. его JSDoc, почему именно `useRef`, а не только
 * `useState`, для гарантированной защиты от двойного клика без ре-рендера между вызовами).
 */
export interface UseOnboardingApplicationFormResult {
  readonly state: OnboardingFormState
  readonly chainErrors: OnboardingFormErrors
  readonly pharmacyErrors: OnboardingFormErrors
  readonly attemptedSubmit: boolean
  readonly markAttemptedSubmit: () => void
  readonly setField: (field: OnboardingTextField, value: string) => void
  readonly setWhitelabel: (value: boolean) => void
  readonly setRegistrationCertificateUrl: (url: string | null) => void
  readonly setLicenseScanUrl: (url: string | null) => void
  readonly isSubmitting: boolean
  /** AC5: `true` — вызывающий код МОЖЕТ продолжить отправку; `false` — уже идёт попытка. */
  readonly trySubmit: () => boolean
  readonly finishSubmit: () => void
}

export function useOnboardingApplicationForm(chainIdForValidation: string | null): UseOnboardingApplicationFormResult {
  const [state, dispatch] = useReducer(onboardingFormReducer, undefined, createInitialOnboardingFormState)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)

  const submitLockRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const chainErrors = useMemo(() => validateChainFields(state), [state])
  const pharmacyErrors = useMemo(
    () => validatePharmacyFields(state, chainIdForValidation),
    [state, chainIdForValidation],
  )

  const setField = useCallback(
    (field: OnboardingTextField, value: string) => { dispatch({ type: 'set_field', field, value }) },
    [dispatch],
  )
  const setWhitelabel = useCallback(
    (value: boolean) => { dispatch({ type: 'set_whitelabel', value }) },
    [dispatch],
  )
  const setRegistrationCertificateUrl = useCallback(
    (url: string | null) => { dispatch({ type: 'set_registration_certificate_url', url }) },
    [dispatch],
  )
  const setLicenseScanUrl = useCallback(
    (url: string | null) => { dispatch({ type: 'set_license_scan_url', url }) },
    [dispatch],
  )

  const markAttemptedSubmit = useCallback(() => { setAttemptedSubmit(true) }, [])

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

  return {
    state,
    chainErrors,
    pharmacyErrors,
    attemptedSubmit,
    markAttemptedSubmit,
    setField,
    setWhitelabel,
    setRegistrationCertificateUrl,
    setLicenseScanUrl,
    isSubmitting,
    trySubmit,
    finishSubmit,
  }
}
