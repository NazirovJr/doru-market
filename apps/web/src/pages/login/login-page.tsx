import { useReducer, useCallback, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { PhoneStep } from '@/features/auth/ui/phone-step'
import { CodeStep } from '@/features/auth/ui/code-step'
import { TelegramStep } from '@/features/auth/ui/telegram-step'
import {
  initialState,
  loginFlowReducer,
  type LoginFlowState,
} from '@/features/auth/model/login-flow.model'

/**
 * `login-page.tsx` (EP-01, DTJ-028 + DTJ-028.5, SRS-UX-002/014/017/018/019/023/027/043).
 *
 * Композиция `phone-step`/`code-step` по состоянию `login-flow.model.ts`.
 * `state.step === 'locked'` → отдельный экран с каноническим текстом
 * `ux.error.otp_locked` и кнопкой «Запросить новый код» (НЕ таймер 5
 * минут, расхождение №2 из дизайна).
 *
 * [DTJ-028.5] `TelegramStep` рендерится НА `step === 'phone'` ВСЕГДА (даже
 * вне TWA-режима — там `disabled` + hint), чтобы пользователь, открывший
 * страницу в обычном браузере, увидел, что есть альтернативный путь
 * (через Telegram Mini App). НЕ рендерится на `step === 'code'` —
 * `code-step` уже занят вводом OTP, дополнительный Telegram-button там
 * только мешает.
 *
 * На успешный verify/Telegram-auth — `useNavigate()` на `intent` (из
 * query-string) или `/` по умолчанию. Маршруты, требующие auth, сохраняют
 * `?intent=/foo/bar` в URL перед редиректом на `/login`; здесь этот
 * intent читается.
 *
 * `LanguageSwitcher` приходит из `AppLayout` (DTJ-003, SRS-UX-027) —
 * переключатель доступен на ВСЕХ неавторизованных экранах, не только на
 * главном (как в дизайне).
 */
const LoginPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(loginFlowReducer, initialState)

  const handlePhoneSuccess = useCallback(
    (phone: string, otpRequestId: string): void => {
      dispatch({ type: 'phoneSubmit', phone, otpRequestId })
    },
    [],
  )

  const handleTelegramSuccess = useCallback((): void => {
    // use-telegram-auth уже положил session в стор; нам остаётся редирект.
    // Тот же intent-flow, что и для verify-OTP.
    const intentRaw = new URLSearchParams(window.location.search).get('intent')
    const target = intentRaw?.startsWith('/') === true ? intentRaw : '/'
    void navigate(target, { replace: true })
  }, [navigate])

  const handleCodeSuccess = useCallback((): void => {
    // use-verify-otp уже положил session в стор; нам остаётся редирект.
    const intentRaw = new URLSearchParams(window.location.search).get('intent')
    const target = intentRaw?.startsWith('/') === true ? intentRaw : '/'
    void navigate(target, { replace: true })
  }, [navigate])

  const handleLockedResend = useCallback((): void => {
    dispatch({ type: 'goBackToPhone' })
  }, [])

  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 py-8"
      data-testid="login-page"
    >
      <h1 className="sr-only">{t('auth.login.phone_title')}</h1>
      {state.step === 'phone' ? (
        <>
          <PhoneStep onSuccess={handlePhoneSuccess} defaultPhone={state.phone} />
          {/* [DTJ-028.5] Telegram-кнопка ПОД phone-step, с визуальным разделителем.
              Кнопка рендерится всегда; вне TWA она disabled с hint. */}
          <div className="mx-auto flex w-full max-w-sm items-center gap-2 text-xs text-ink-muted">
            <span className="h-px flex-1 bg-line" />
            <span>{t('brand.name')}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <TelegramStep onSuccess={handleTelegramSuccess} />
        </>
      ) : state.step === 'code' ? (
        <CodeStep
          state={state}
          onSuccess={handleCodeSuccess}
          onMismatch={(): void => {
            dispatch({ type: 'codeMismatch' })
          }}
          onExpired={(): void => {
            dispatch({ type: 'codeExpired' })
          }}
          onLocked={(): void => {
            dispatch({ type: 'codeLocked' })
          }}
          onResend={(): void => {
            dispatch({ type: 'resendRequested' })
          }}
          onCooldownTick={(): void => {
            dispatch({ type: 'tick', now: new Date() })
          }}
        />
      ) : (
        <LockedScreen
          errorText={t('ux.error.otp_locked')}
          resendLabel={t('auth.login.resend_code')}
          onResend={handleLockedResend}
        />
      )}
    </section>
  )
}

export default LoginPage

const LockedScreen = ({
  errorText,
  resendLabel,
  onResend,
}: {
  readonly errorText: string
  readonly resendLabel: string
  readonly onResend: () => void
}): ReactElement => {
  return (
    <div className="flex flex-col gap-4" data-testid="locked-screen">
      <p
        role="alert"
        className="text-base text-ink"
      >
        {errorText}
      </p>
      {/* ВАЖНО: НЕТ таймера обратного отсчёта 5 минут (расхождение №2). */}
      <button
        type="button"
        onClick={onResend}
        className="rounded-md bg-brand-primary px-4 py-2 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand-primary"
        style={{ minHeight: 48 }}
      >
        {resendLabel}
      </button>
    </div>
  )
}

/**
 * Вспомогательная фабрика — только для тестов (DTJ-028 «Тест-план»).
 * UI-слой работает через reducer; тесты могут напрямую импортировать
 * `loginFlowReducer` из `model/login-flow.model.ts`.
 */
export function _testing(state: LoginFlowState): LoginFlowState {
  return state
}
