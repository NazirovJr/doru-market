import { useCallback, useReducer, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '@dorutj/i18n'
import { Button } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { PhoneStep } from '@/features/auth/ui/phone-step'
import { CodeStep } from '@/features/auth/ui/code-step'
import { useAuthStore } from '@/shared/auth/auth-store'
import { isAdminRole } from '@/shared/auth/auth-guard'
import { initialState, loginFlowReducer } from '@/features/auth/model/login-flow.model'

const LoginPage = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(loginFlowReducer, initialState)
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null)

  const handlePhoneSuccess = useCallback((phone: string, otpRequestId: string): void => {
    setAccessDeniedMessage(null)
    dispatch({ type: 'phoneSubmit', phone, otpRequestId })
  }, [])

  // Критерий приёмки 4: OTP-verify роле-агностичен — отказ неподходящей роли делаем здесь, до
  // навигации, сессию не оставляем (см. shared/auth/auth-guard.tsx — вторая линия защиты).
  const handleCodeSuccess = useCallback((): void => {
    const user = useAuthStore.getState().user
    if (user !== null && !isAdminRole(user.role)) {
      useAuthStore.getState().clear()
      setAccessDeniedMessage(t('auth.login.admin_role_denied'))
      dispatch({ type: 'goBackToPhone' })
      return
    }
    void navigate('/', { replace: true })
  }, [navigate, t])

  const handleLockedResend = useCallback((): void => {
    dispatch({ type: 'goBackToPhone' })
  }, [])

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 py-8" data-testid="login-page">
      <h1 className="text-center text-xl font-semibold text-ink">{t('auth.login.admin_heading')}</h1>
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
        <LockedScreen errorText={t('ux.error.otp_locked')} resendLabel={t('auth.login.resend_code')} onResend={handleLockedResend} />
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
}): ReactElement => (
  <div className="flex flex-col gap-4" data-testid="locked-screen">
    <p role="alert" className="text-base text-ink">
      {errorText}
    </p>
    <Button type="button" onClick={onResend}>
      {resendLabel}
    </Button>
  </div>
)
