import { useState, useId, type ReactElement, type SubmitEvent } from 'react'
import { useT } from '@dorutj/i18n'
import { useRequestOtp } from '@/features/auth/api/use-request-otp'
import { HttpError } from '@/shared/api/http-client'

/**
 * `phone-step.tsx` (DTJ-166) — портировано из `apps/web/src/features/auth/ui/phone-step.tsx`
 * (EP-01, DTJ-028, `SRS-UX-002/018/019/023`), логика и разметка БЕЗ изменений.
 *
 * Единственная адаптация: локаль зафиксирована на `'tj'` напрямую (`useT('tj')`) вместо
 * `useLocale()` — `apps/pharmacy` не имеет требования на переключатель языка (в отличие от
 * `apps/web`, `SRS-UX-027`), полноценный `LocaleProvider` не заводился, чтобы не расширять scope
 * DTJ-166 сверх `files_owned`. TODO(EP-18): если кабинету аптеки потребуется переключатель —
 * завести `shared/config/locale-provider.tsx` по образцу `apps/web` и убрать этот хардкод.
 *
 * Поле телефона с фиксированным префиксом `+992` (маска `XX XXX XX XX`). Кнопка «Отправить код» —
 * `disabled` до 9 цифр. TODO(EP-18): заменить сырой `<input>`/`<button>` на `packages/ui`
 * (FormField, PrimaryButton), когда дизайн-система перестанет быть заглушкой.
 */

const PHONE_PREFIX = '+992'
const PHONE_DIGITS_REQUIRED = 9
const PHONE_MASK_FULL = 9
const PHONE_MASK_FIRST_END = 2
const PHONE_MASK_SECOND_END = 5
const PHONE_MASK_THIRD_END = 7
const PHONE_MASK_FOURTH_END = 9
const PHONE_MASK_BOUNDARIES = [
  PHONE_MASK_FIRST_END,
  PHONE_MASK_SECOND_END,
  PHONE_MASK_THIRD_END,
  PHONE_MASK_FOURTH_END,
]
const MIN_TAP_ZONE_PX = 48

export function formatPhone(digitsOnly: string): string {
  // `XX XXX XX XX`. Маска применяется ТОЛЬКО на display, в API уходит E.164.
  const cleaned = digitsOnly.replace(/\D/g, '').slice(0, PHONE_MASK_FULL)
  const groups: string[] = []
  let start = 0
  for (const end of PHONE_MASK_BOUNDARIES) {
    if (start >= cleaned.length) {
      break
    }
    groups.push(cleaned.slice(start, end))
    start = end
  }
  return groups.join(' ')
}

export function toE164(digitsOnly: string): string {
  return `${PHONE_PREFIX}${digitsOnly.replace(/\D/g, '').slice(0, PHONE_DIGITS_REQUIRED)}`
}

export interface PhoneStepProps {
  readonly onSuccess: (phoneE164: string, otpRequestId: string) => void
  readonly defaultPhone?: string
}

export const PhoneStep = ({ onSuccess, defaultPhone = '' }: PhoneStepProps): ReactElement => {
  const { t } = useT('tj')
  const inputId = useId()
  const [digits, setDigits] = useState<string>(
    defaultPhone.startsWith(PHONE_PREFIX)
      ? defaultPhone.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, PHONE_DIGITS_REQUIRED)
      : '',
  )
  const [errorMessage, setErrorMessage] = useState<string>('')
  const mutation = useRequestOtp()

  const isSubmitting = mutation.isPending
  const isValid = digits.replace(/\D/g, '').length === PHONE_DIGITS_REQUIRED

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!isValid || isSubmitting) {
      return
    }
    setErrorMessage('')
    const phoneE164 = toE164(digits)
    mutation.mutate(
      { phone: phoneE164 },
      {
        onSuccess: (response): void => {
          onSuccess(phoneE164, response.otpRequestId)
        },
        onError: (err): void => {
          if (err instanceof HttpError) {
            if (err.code === 'INVALID_PHONE_FORMAT') {
              setErrorMessage(t('auth.login.phone_hint'))
            } else if (err.code === 'OTP_REQUEST_RATE_LIMITED') {
              setErrorMessage(t('ux.error.otp_locked'))
            } else {
              setErrorMessage(t('ux.error.generic_500'))
            }
          } else {
            // Сетевая ошибка (offline, таймаут) — форма НЕ сбрасывается, ввод сохраняется.
            setErrorMessage(t('ux.error.network_offline'))
          }
        },
      },
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-sm flex-col gap-3"
      data-testid="phone-step"
    >
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {t('auth.login.phone_title')}
      </label>
      <div
        className="flex items-center gap-2 rounded-md border border-line bg-surface px-3"
        style={{ minHeight: MIN_TAP_ZONE_PX }}
      >
        <span className="font-mono text-ink-muted">{PHONE_PREFIX}</span>
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          autoFocus
          disabled={isSubmitting}
          value={formatPhone(digits)}
          onChange={(e): void => {
            setDigits(e.target.value.replace(/\D/g, '').slice(0, PHONE_DIGITS_REQUIRED))
          }}
          placeholder={t('auth.login.phone_placeholder').replace(PHONE_PREFIX, '').trim()}
          aria-invalid={errorMessage.length > 0}
          aria-describedby={errorMessage.length > 0 ? `${inputId}-error` : undefined}
          className="w-full bg-transparent py-2 text-base text-ink outline-none focus:ring-2 focus:ring-brand-primary"
        />
      </div>
      <p className="text-xs text-ink-muted">{t('auth.login.phone_hint')}</p>
      {errorMessage.length > 0 ? (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-sm text-red-600"
          data-testid="phone-step-error"
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!isValid || isSubmitting}
        className="rounded-md bg-brand-primary px-4 py-2 font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-primary"
        style={{ minHeight: MIN_TAP_ZONE_PX }}
      >
        {isSubmitting ? `${t('auth.login.phone_title')}…` : t('auth.login.resend_code')}
      </button>
    </form>
  )
}
