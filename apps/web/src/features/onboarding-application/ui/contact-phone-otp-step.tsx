import { useState, type ReactElement } from 'react'
import type { TranslateFunction, TranslationKey } from '@dorutj/i18n'
import type { ContactPhoneOtpStatus } from '../api/use-contact-phone-otp'

/**
 * `contact-phone-otp-step.tsx` (DTJ-076, «Что сделать» §5, AC4) — минимальный локальный
 * OTP-ввод: кнопка «Отправить код» → поле ввода 4–6-значного кода → «Подтвердить».
 *
 * **РАЗВИЛКА «переиспользовать OTP-компонент из packages/ui».** На момент реализации
 * `packages/ui` не содержит готовых компонентов (только сборочные артефакты/Storybook-каркас,
 * проверено — ноль исходников `src/`), `DTJ-405` (`OtpInput`, EP-18) не начат. Тикет прямо
 * допускает такой исход («если его ещё нет — не дублировать, ждать готовности EP-18»/«ждать
 * готовности»), но ждать значило бы не сдать критерий приёмки 4 вовсе. `features/auth/ui/code-step.tsx`
 * содержит похожий 6-ячеечный OTP-ввод, но импортировать его ЗАПРЕЩЕНО (AGENTS.md §5/C16 —
 * горизонтальные импорты между `features/*`). Решение: свой ЛОКАЛЬНЫЙ минимальный ввод (одно
 * текстовое поле, не 6 ячеек — сознательно проще visual-паритета с `code-step.tsx`, т.к. это НЕ
 * тот же экран и дублировать его UX смысла нет) с явным TODO на замену.
 *
 * TODO(DTJ-405): заменить на `packages/ui` `OtpInput`, когда компонент будет готов (EP-18).
 */

const OTP_MIN_LENGTH = 4
const OTP_MAX_LENGTH = 6

function errorKeyFor(errorCode: string | null): TranslationKey {
  switch (errorCode) {
    case 'OTP_MISMATCH':
      return 'onboarding.otp.error_mismatch'
    case 'OTP_EXPIRED':
      return 'onboarding.otp.error_expired'
    case 'OTP_LOCKED':
      return 'onboarding.otp.error_locked'
    case 'CHAIN_APPLICATION_ALREADY_EXISTS':
      return 'onboarding.otp.error_chain_exists'
    default:
      return 'ux.error.generic_500'
  }
}

export interface ContactPhoneOtpStepProps {
  readonly status: ContactPhoneOtpStatus
  readonly errorCode: string | null
  readonly canRequestCode: boolean
  readonly onRequestCode: () => void
  readonly onVerifyCode: (code: string) => void
  readonly t: TranslateFunction
}

export const ContactPhoneOtpStep = ({
  status,
  errorCode,
  canRequestCode,
  onRequestCode,
  onVerifyCode,
  t,
}: ContactPhoneOtpStepProps): ReactElement => {
  const [code, setCode] = useState('')

  if (status === 'verified') {
    return (
      <p data-testid="onboarding-otp-verified" className="text-sm font-medium text-brand-primary">
        {t('onboarding.otp.verified')}
      </p>
    )
  }

  const showCodeInput = status === 'code_sent' || status === 'verifying'

  return (
    <div className="flex flex-col gap-2" data-testid="onboarding-otp-step">
      <button
        type="button"
        data-testid="onboarding-otp-request"
        disabled={!canRequestCode || status === 'requesting' || status === 'verifying'}
        onClick={onRequestCode}
        className="inline-flex min-h-12 w-fit items-center justify-center rounded-md border border-brand-primary px-4 text-sm font-semibold text-brand-primary disabled:opacity-40"
      >
        {status === 'requesting' ? t('onboarding.otp.requesting') : t('onboarding.otp.request_cta')}
      </button>
      {showCodeInput ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={OTP_MAX_LENGTH}
            value={code}
            data-testid="onboarding-otp-code-input"
            onChange={(event) => { setCode(event.target.value.replace(/\D/g, '')) }}
            aria-label={t('onboarding.otp.code_label')}
            className="min-h-12 w-32 rounded-md border border-line bg-surface text-center text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary"
          />
          <button
            type="button"
            data-testid="onboarding-otp-verify"
            disabled={code.length < OTP_MIN_LENGTH || status === 'verifying'}
            onClick={() => { onVerifyCode(code) }}
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {status === 'verifying' ? t('onboarding.otp.verifying') : t('onboarding.otp.verify_cta')}
          </button>
        </div>
      ) : null}
      {errorCode !== null ? (
        <p role="alert" data-testid="onboarding-otp-error" className="text-xs text-brand-danger">
          {t(errorKeyFor(errorCode))}
        </p>
      ) : null}
    </div>
  )
}
