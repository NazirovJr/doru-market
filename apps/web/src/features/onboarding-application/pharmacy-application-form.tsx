import { useCallback, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { HttpError } from '@/shared/api/http-client'
import { useContactPhoneOtp } from './api/use-contact-phone-otp'
import { submitChainForReview, submitPharmacyApplication, submitPharmacyForReview } from './api/onboarding-application.api'
import { useOnboardingApplicationForm } from './model/use-onboarding-application-form'
import { buildChainPayload, buildPharmacyPayload, hasErrors } from './model/onboarding-form.model'
import { LegalEntitySection } from './ui/legal-entity-section'
import { PharmacyDetailsSection } from './ui/pharmacy-details-section'
import { SuccessScreen } from './ui/success-screen'

/**
 * `PharmacyApplicationForm` (DTJ-076) — единственный публичный вход заявки аптеки/сети
 * (`/pharmacy-application`, без аутентификации, REQ-MARKET-7). Смонтирован в `app/router.tsx`
 * (`lazy`, путь и имя экспорта НЕ менялись — правка роутера не потребовалась).
 *
 * ОДНА длинная форма со скроллом (тикет допускает такую форму вместо многошаговой, если
 * многошаговость не даёт ощутимого UX-выигрыша — решение исполнителя): секция «Юр. лицо и
 * контакт» (+ встроенный OTP-шаг телефона, AC4, + условные whitelabel-поля, AC2) —
 * `ui/legal-entity-section.tsx`; секция «Аптека/точка» (+ загрузка лицензии, AC3) —
 * `ui/pharmacy-details-section.tsx`; здесь — только композиция + оркестрация финального сабмита
 * (AC1/AC5).
 *
 * **Почему `PharmacyChain` создаётся ЯВНО и для соло-аптеки тоже** (расхождение с буквальным
 * прочтением п.6 «Что сделать»: «POST /pharmacy-chains ИЛИ POST /pharmacy-accounts» как
 * взаимоисключающих вызовов) — см. JSDoc `api/use-contact-phone-otp.ts`: OTP-эндпоинты существуют
 * только на ресурсе `pharmacy-chains`, без явного создания сети верифицировать телефон было бы
 * нечем. Финальный сабмит поэтому — `POST /pharmacy-accounts` (создание точки под уже созданной
 * сетью) → `POST /pharmacy-accounts/:id/submit` → `POST /pharmacy-chains/:id/submit` (сеть тоже
 * переводится в `pending_review`, иначе она осталась бы в `draft` и не попала бы в очередь
 * `GET /pharmacy-chains?status=pending_review`, SRS-ADM-009 — заявка с whitelabel-данными иначе
 * никогда не увидена оператором). Три вызова, не два буквально — но для пользователя всё ещё ОДНО
 * действие за ОДНОЙ кнопкой, с ОДНИМ экраном успеха (тикет, «Риски»). См. ДОПУЩЕНИЯ в отчёте
 * сдачи тикета.
 */

export const PharmacyApplicationForm = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const navigate = useNavigate()

  const otp = useContactPhoneOtp()
  const form = useOnboardingApplicationForm(otp.chainId)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const canRequestOtp = !hasErrors(form.chainErrors)
  const isFormValid = !hasErrors(form.chainErrors) && !hasErrors(form.pharmacyErrors) && otp.status === 'verified'

  const handleRequestOtp = useCallback(() => {
    void otp.requestCode(() => buildChainPayload(form.state))
  }, [otp, form.state])

  const handleVerifyOtp = useCallback((code: string) => { void otp.verifyCode(code) }, [otp])

  const submitApplication = useCallback(async (chainId: string): Promise<void> => {
    try {
      const pharmacy = await submitPharmacyApplication(buildPharmacyPayload(form.state, chainId))
      await submitPharmacyForReview(pharmacy.id)
      await submitChainForReview(chainId)
      setSuccessId(pharmacy.id)
    } catch (err: unknown) {
      setSubmitError(err instanceof HttpError ? t('ux.error.generic_500') : t('ux.error.network_offline'))
    } finally {
      form.finishSubmit()
    }
  }, [form, t])

  const handleSubmit = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault()
      form.markAttemptedSubmit()
      if (!isFormValid || otp.chainId === null || !form.trySubmit()) {
        return
      }
      setSubmitError(null)
      void submitApplication(otp.chainId)
    },
    [form, isFormValid, otp.chainId, submitApplication],
  )

  if (successId !== null) {
    return <SuccessScreen applicationId={successId} onHome={() => { void navigate('/') }} t={t} />
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex max-w-lg flex-col gap-6 p-4" data-testid="pharmacy-application-form">
      <h1 className="text-lg font-bold text-ink">{t('onboarding.title')}</h1>

      <LegalEntitySection
        state={form.state}
        errors={form.chainErrors}
        attemptedSubmit={form.attemptedSubmit}
        setField={form.setField}
        setWhitelabel={form.setWhitelabel}
        setRegistrationCertificateUrl={form.setRegistrationCertificateUrl}
        otpStatus={otp.status}
        otpErrorCode={otp.errorCode}
        canRequestOtp={canRequestOtp}
        onRequestOtp={handleRequestOtp}
        onVerifyOtp={handleVerifyOtp}
        t={t}
      />

      <PharmacyDetailsSection
        state={form.state}
        errors={form.pharmacyErrors}
        attemptedSubmit={form.attemptedSubmit}
        setField={form.setField}
        setLicenseScanUrl={form.setLicenseScanUrl}
        t={t}
      />

      {submitError !== null ? (
        <p role="alert" data-testid="pharmacy-application-error" className="text-sm text-brand-danger">
          {submitError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={form.isSubmitting}
        data-testid="pharmacy-application-submit"
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-primary px-6 font-semibold text-white disabled:opacity-40"
      >
        {form.isSubmitting ? t('onboarding.submit_pending') : t('onboarding.submit_cta')}
      </button>
    </form>
  )
}
