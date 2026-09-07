import { useState, useEffect, useRef, useId, type ReactElement, type KeyboardEvent } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { useVerifyOtp } from '@/features/auth/api/use-verify-otp'
import { HttpError } from '@/shared/api/http-client'
import {
  errorCodeToI18nKey,
  MAX_VERIFY_ATTEMPTS,
  type LoginFlowState,
} from '@/features/auth/model/login-flow.model'

/**
 * `code-step.tsx` (EP-01, DTJ-028, SRS-UX-002/014/018/019/023).
 *
 * 6-ячеечный OTP-ввод (как в дизайне). Авто-переход между ячейками,
 * авто-submit на 6-й цифре. `Backspace` на пустой ячейке → переход назад.
 *
 * Расхождения от дизайна (DTJ-028 «Технический контекст»):
 *   - №1 (5 попыток): `attemptsLeft` берётся из `state.attemptsLeft`,
 *     передаётся в `ux.error.otp_mismatch({ attemptsLeft })`.
 *   - №2 (НЕ таймер 5 минут): `step === 'locked'` тут НЕ рендерится —
 *     `login-page` отвечает за `state.step === 'locked'` отдельной кнопкой
 *     «Запросить новый код». Здесь — только активный ввод + сообщение об
 *     ошибке.
 *   - №4 (hit-slop ≥48×48px): `min-width: 48px; min-height: 48px` на ячейку.
 *   - №5 (`--focus-ring`): `focus:ring-2 focus:ring-brand-primary`.
 *
 * Cooldown-таймер для resend: `useEffect` с `setInterval(1000)`, вызывает
 * `onCooldownTick()` каждую секунду; UI в `login-page` заводит `tick`-event
 * в reducer.
 *
 * TODO(EP-18): заменить `OTPInput` (этот файл) на `packages/ui/OtpField`,
 * когда появится (тикет `EP-18-OTP-FIELD`).
 */

const OTP_LENGTH = 6
const MIN_TAP_ZONE_PX = 48

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
  const formId = useId()
  const [code, setCode] = useState<string[]>(Array.from({ length: OTP_LENGTH }, () => ''))
  const [networkError, setNetworkError] = useState<string>('')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const mutation = useVerifyOtp()
  const isSubmitting = mutation.isPending
  const errorText = useErrorText(state, t, networkError)

  // Cooldown-таймер: тик каждую секунду, пока `resendCooldownSeconds > 0`.
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

  const setCell = (index: number, value: string): void => {
    const next = [...code]
    next[index] = value
    setCode(next)
    if (value.length > 0 && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleCellKey = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace' && code[index] === '' && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const submit = (fullCode: string): void => {
    if (fullCode.length !== OTP_LENGTH || state.otpRequestId === null) {
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
            // Сетевая ошибка (offline, таймаут) — НЕ сбрасываем введённый
            // код (негативный сценарий #3 тикета), но и НЕ уменьшаем
            // attemptsLeft (он клиентский, только для UX).
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
      <div
        className="flex justify-center gap-2"
        role="group"
        aria-label={t('auth.login.code_title')}
      >
        {code.map((cell, index) => (
          <input
            key={`${formId}-cell-${String(index)}`}
            ref={(el): void => {
              inputRefs.current[index] = el
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            autoFocus={index === 0}
            disabled={isSubmitting}
            value={cell}
            onChange={(e): void => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 1)
              setCell(index, value)
              if (value.length > 0 && index === OTP_LENGTH - 1) {
                const fullCode = code.map((c, i) => (i === index ? value : c)).join('')
                submit(fullCode)
              }
            }}
            onKeyDown={(e): void => {
              handleCellKey(index, e)
            }}
            aria-label={`${t('auth.login.code_title')} ${String(index + 1)}`}
            className="rounded-md border border-line bg-surface text-center text-lg font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary"
            style={{ minWidth: MIN_TAP_ZONE_PX, minHeight: MIN_TAP_ZONE_PX }}
          />
        ))}
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
        <button
          type="button"
          onClick={onResend}
          disabled={state.resendCooldownSeconds > 0 || isSubmitting}
          className="text-brand-primary disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-primary"
          style={{ minHeight: MIN_TAP_ZONE_PX }}
        >
          {state.resendCooldownSeconds > 0
            ? t('auth.login.resend_countdown', { seconds: state.resendCooldownSeconds })
            : t('auth.login.resend_code')}
        </button>
        <span className="text-ink-muted">
          {state.attemptsLeft} / {MAX_VERIFY_ATTEMPTS}
        </span>
      </div>
    </div>
  )
}

function useErrorText(state: LoginFlowState, t: TranslateFunction, networkError: string): string | null {
  if (networkError.length > 0) {
    return networkError
  }
  const mapping = errorCodeToI18nKey(state.errorCode)
  if (mapping === null) {
    return null
  }
  // Подставляем `attemptsLeft` для OTP_MISMATCH.
  if (state.errorCode === 'OTP_MISMATCH') {
    return t(mapping.key, { ...mapping.params, attemptsLeft: state.attemptsLeft })
  }
  return t(mapping.key, mapping.params)
}
