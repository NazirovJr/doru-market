import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, OtpInput } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useVerifyOtp } from '@/features/auth/api/use-verify-otp'
import { HttpError } from '@/shared/api/http-client'
import {
  errorCodeToI18nKey,
  MAX_VERIFY_ATTEMPTS,
  type LoginFlowState,
} from '@/features/auth/model/login-flow.model'

/**
 * `code-step.tsx` (DTJ-166, DTJ-433) — портировано из `apps/web/src/features/auth/ui/code-step.tsx`
 * (EP-01, DTJ-028, `SRS-UX-002/014/018/019/023`). DTJ-433: локаль — из `LocaleProvider`, ввод кода —
 * `packages/ui` `OtpInput` (DTJ-405, 6 ячеек, авто-переход/авто-submit/paste — встроены в компонент)
 * вместо локальной реализации. Cooldown-таймер для resend — `setInterval(1000)`.
 */

const OTP_LENGTH = 6

export interface CodeStepProps {
  readonly state: LoginFlowState
  readonly onSuccess: () => void
  readonly onMismatch: () => void
  readonly onExpired: () => void
  readonly onLocked: () => void
  readonly onResend: () => void
  readonly onCooldownTick: () => void
}

export const CodeStep = ({
  state,
  onSuccess,
  onMismatch,
  onExpired,
  onLocked,
  onResend,
  onCooldownTick,
}: CodeStepProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [networkError, setNetworkError] = useState<string>('')

  const mutation = useVerifyOtp()
  const isSubmitting = mutation.isPending
  const errorText = useErrorText(state, t, networkError)

  useEffect((): (() => void) | undefined => {
    if (state.resendCooldownSeconds <= 0) {
      return undefined
    }
    const interval = setInterval(() => {
      onCooldownTick()
    }, 1000)
    return (): void => {
      clearInterval(interval)
    }
  }, [state.resendCooldownSeconds, onCooldownTick])

  const submit = (fullCode: string): void => {
    if (state.otpRequestId === null) {
      return
    }
    setNetworkError('')
    mutation.mutate(
      { otpRequestId: state.otpRequestId, code: fullCode },
      {
        onSuccess: (): void => {
          onSuccess()
        },
        onError: (err): void => {
          if (err instanceof HttpError) {
            if (err.code === 'OTP_LOCKED') {
              onLocked()
            } else if (err.code === 'OTP_EXPIRED') {
              onExpired()
            } else if (err.code === 'OTP_MISMATCH') {
              onMismatch()
            } else {
              setNetworkError(t('ux.error.generic_500'))
            }
          } else {
            // Сетевая ошибка — код не сбрасываем, attemptsLeft (клиентский) не уменьшаем.
            setNetworkError(t('ux.error.network_offline'))
          }
        },
      },
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3" data-testid="code-step">
      <p className="text-sm text-ink-muted">
        {t('auth.login.code_sent_to', { phone: state.phone })}
      </p>
      <div className="flex justify-center">
        <OtpInput
          length={OTP_LENGTH}
          label={t('auth.login.code_title')}
          error={errorText !== null}
          locked={isSubmitting}
          locale={locale}
          autoFocus
          onComplete={submit}
        />
      </div>
      {errorText !== null ? (
        <p
          role="alert"
          className="text-sm text-red-600"
          data-testid="code-step-error"
        >
          {errorText}
        </p>
      ) : null}
      <div className="flex items-center justify-between text-sm">
        <Button
          type="button"
          variant="ghost"
          onClick={onResend}
          disabled={state.resendCooldownSeconds > 0 || isSubmitting}
        >
          {state.resendCooldownSeconds > 0
            ? t('auth.login.resend_countdown', { seconds: state.resendCooldownSeconds })
            : t('auth.login.resend_code')}
        </Button>
        <span className="text-ink-muted">
          {state.attemptsLeft} / {MAX_VERIFY_ATTEMPTS}
        </span>
      </div>
    </div>
  )
}

function useErrorText(
  state: LoginFlowState,
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
  networkError: string,
): string | null {
  if (networkError.length > 0) {
    return networkError
  }
  const mapping = errorCodeToI18nKey(state.errorCode)
  if (state.errorCode === 'OTP_MISMATCH' && mapping !== null) {
    return t(mapping.key, { ...mapping.params, attemptsLeft: state.attemptsLeft })
  }
  if (mapping !== null) {
    return t(mapping.key, mapping.params)
  }
  return null
}
