import { useCallback, useReducer, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '@dorutj/i18n'
import { PhoneStep } from '@/features/auth/ui/phone-step'
import { CodeStep } from '@/features/auth/ui/code-step'
import { useAuthStore } from '@/shared/api/auth-store'
import { isPharmacyRole } from '@/shared/auth/auth-guard'
import { initialState, loginFlowReducer } from '@/features/auth/model/login-flow.model'

/**
 * `LoginPage.tsx` (DTJ-166, SRS-UX-022) — первый экран кабинета аптеки. Композиция
 * `phone-step`/`code-step` по состоянию `login-flow.model.ts`, тот же паттерн, что
 * `apps/web/src/pages/login/login-page.tsx` (EP-01, DTJ-028), БЕЗ Telegram-входа
 * (`TelegramStep`/`use-telegram-auth`) — кабинет аптеки не предусматривает Telegram Mini App
 * (только SMS-OTP, DTJ-166 «Технический контекст») и без `LanguageSwitcher` (нет требования
 * SRS-UX-027 для этого приложения, см. `phone-step.tsx` JSDoc).
 *
 * Критерий приёмки 4 (DTJ-166): `customer`/`courier` технически проходят OTP-verify (эндпоинт
 * роле-агностичен, см. `use-verify-otp.ts`), но здесь, СРАЗУ после успеха и ДО навигации на
 * `/inventory`, проверяется `user.role`. Неподходящая роль → сессия немедленно очищается
 * (`useAuthStore.clear()` — нет смысла держать в localStorage валидный refresh-токен для
 * кабинета, куда этой роли нет доступа), пользователь возвращается на шаг «телефон» с понятным
 * сообщением, БЕЗ навигации. `shared/auth/auth-guard.tsx` — вторая линия защиты (defense-in-depth)
 * на случай прямого перехода по URL с уже сохранённой (чужой) сессией.
 */
const LoginPage = (): ReactElement => {
  const { t } = useT('tj')
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(loginFlowReducer, initialState)
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null)

  const handlePhoneSuccess = useCallback((phone: string, otpRequestId: string): void => {
    setAccessDeniedMessage(null)
    dispatch({ type: 'phoneSubmit', phone, otpRequestId })
  }, [])

  const handleCodeSuccess = useCallback((): void => {
    // use-verify-otp уже положил session в стор; здесь — только проверка роли (критерий приёмки 4).
    const user = useAuthStore.getState().user
    if (user !== null && !isPharmacyRole(user.role)) {
      useAuthStore.getState().clear()
      setAccessDeniedMessage(t('auth.login.pharmacy_role_denied'))
      dispatch({ type: 'goBackToPhone' })
      return
    }
    void navigate('/inventory', { replace: true })
  }, [navigate, t])

  const handleLockedResend = useCallback((): void => {
    dispatch({ type: 'goBackToPhone' })
  }, [])

  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-6 py-8"
      data-testid="login-page"
    >
      <h1 className="text-center text-xl font-semibold text-ink">{t('auth.login.pharmacy_heading')}</h1>
      {accessDeniedMessage !== null ? (
        <p role="alert" className="text-sm text-red-600" data-testid="role-denied-error">
          {accessDeniedMessage}
        </p>
      ) : null}
      {state.step === 'phone' ? (
        <PhoneStep onSuccess={handlePhoneSuccess} defaultPhone={state.phone} />
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

const LOCKED_BUTTON_MIN_HEIGHT_PX = 48

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
      <p role="alert" className="text-base text-ink">
        {errorText}
      </p>
      <button
        type="button"
        onClick={onResend}
        className="rounded-md bg-brand-primary px-4 py-2 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-brand-primary"
        style={{ minHeight: LOCKED_BUTTON_MIN_HEIGHT_PX }}
      >
        {resendLabel}
      </button>
    </div>
  )
}
