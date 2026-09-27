import { useState, type ReactElement, type SubmitEvent } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, PhoneInput } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useRequestOtp } from '@/features/auth/api/use-request-otp'
import { HttpError } from '@/shared/api/http-client'

/**
 * `phone-step.tsx` (DTJ-166, DTJ-433) — портировано из `apps/web/src/features/auth/ui/phone-step.tsx`
 * (EP-01, DTJ-028, `SRS-UX-002/018/019/023`). DTJ-433: локаль берётся из `LocaleProvider`
 * (`useLocale`, не хардкод `'tj'`), поле/кнопка — `packages/ui` `PhoneInput`/`Button` (DTJ-405/404)
 * вместо сырых `<input>`/`<button>`.
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
  const { locale } = useLocale()
  const { t } = useT(locale)
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
      <PhoneInput
        label={t('auth.login.phone_title')}
        value={defaultPhone}
        disabled={isSubmitting}
        locale={locale}
        autoFocus
        onChange={(e164): void => {
          // `PhoneInput` всегда отдаёт `${PHONE_PREFIX}${национальные цифры}` (см. её `toE164`).
          setDigits(e164.startsWith(PHONE_PREFIX) ? e164.slice(PHONE_PREFIX.length) : e164.replace(/\D/g, ''))
        }}
      />
      <p className="text-xs text-ink-muted">{t('auth.login.phone_hint')}</p>
      {errorMessage.length > 0 ? (
        <p role="alert" className="text-sm text-red-600" data-testid="phone-step-error">
          {errorMessage}
        </p>
      ) : null}
      <Button type="submit" disabled={!isValid || isSubmitting} loading={isSubmitting}>
        {t('auth.login.resend_code')}
      </Button>
    </form>
  )
}
