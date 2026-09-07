import type { ChangeEvent, ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'
import type { ContactPhoneOtpStatus } from '../api/use-contact-phone-otp'
import type { OnboardingFormErrors, OnboardingFormState, OnboardingTextField } from '../model/onboarding-form.model'
import { ContactPhoneOtpStep } from './contact-phone-otp-step'
import { FileUploadField } from './file-upload-field'
import { FieldError, inputClassName } from './form-field'

/**
 * `legal-entity-section.tsx` (DTJ-076, «Что сделать» §1/2/3/5) — раздел «Юр. лицо и контакт»:
 * поля `SubmitChainApplicationRequestSchema` + встроенный OTP-шаг + условные whitelabel-поля
 * (AC2). Вынесен из `pharmacy-application-form.tsx` отдельным компонентом — тот же приём, что
 * `checkout/ui/address-picker-section.tsx`/`payment-method-section.tsx` (одна секция — один файл,
 * держит `max-lines-per-function`/`complexity` композиции в пределах порога).
 */
export interface LegalEntitySectionProps {
  readonly state: OnboardingFormState
  readonly errors: OnboardingFormErrors
  readonly attemptedSubmit: boolean
  readonly setField: (field: OnboardingTextField, value: string) => void
  readonly setWhitelabel: (value: boolean) => void
  readonly setRegistrationCertificateUrl: (url: string | null) => void
  readonly otpStatus: ContactPhoneOtpStatus
  readonly otpErrorCode: string | null
  readonly canRequestOtp: boolean
  readonly onRequestOtp: () => void
  readonly onVerifyOtp: (code: string) => void
  readonly t: TranslateFunction
}

export const LegalEntitySection = ({
  state,
  errors,
  attemptedSubmit,
  setField,
  setWhitelabel,
  setRegistrationCertificateUrl,
  otpStatus,
  otpErrorCode,
  canRequestOtp,
  onRequestOtp,
  onVerifyOtp,
  t,
}: LegalEntitySectionProps): ReactElement => {
  const setText = (field: OnboardingTextField) => (event: ChangeEvent<HTMLInputElement>): void => {
    setField(field, event.target.value)
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold text-ink">{t('onboarding.legal.title')}</legend>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-legal-entity-name">
          {t('onboarding.legal.legal_entity_name_label')}
        </label>
        <input
          id="onboarding-legal-entity-name"
          className={inputClassName}
          value={state.legalEntityName}
          onChange={setText('legalEntityName')}
          data-testid="onboarding-legal-entity-name"
        />
        <FieldError shown={attemptedSubmit && errors.legalEntityName !== undefined} t={t} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-tin-inn">
          {t('onboarding.legal.tin_inn_label')}
        </label>
        <input
          id="onboarding-tin-inn"
          className={inputClassName}
          value={state.tinInn}
          onChange={setText('tinInn')}
          data-testid="onboarding-tin-inn"
        />
        <FieldError shown={attemptedSubmit && errors.tinInn !== undefined} t={t} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-director-full-name">
          {t('onboarding.legal.director_full_name_label')}
        </label>
        <input
          id="onboarding-director-full-name"
          className={inputClassName}
          value={state.directorFullName}
          onChange={setText('directorFullName')}
          data-testid="onboarding-director-full-name"
        />
        <FieldError shown={attemptedSubmit && errors.directorFullName !== undefined} t={t} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-contact-phone">
          {t('onboarding.legal.contact_phone_label')}
        </label>
        <input
          id="onboarding-contact-phone"
          type="tel"
          className={inputClassName}
          value={state.contactPhone}
          onChange={setText('contactPhone')}
          data-testid="onboarding-contact-phone"
          disabled={otpStatus === 'verified'}
        />
        <FieldError shown={attemptedSubmit && errors.contactPhone !== undefined} t={t} />
      </div>

      <ContactPhoneOtpStep
        status={otpStatus}
        errorCode={otpErrorCode}
        canRequestCode={canRequestOtp}
        onRequestCode={onRequestOtp}
        onVerifyCode={onVerifyOtp}
        t={t}
      />

      <label className="flex min-h-12 items-center gap-2 text-sm text-ink" htmlFor="onboarding-whitelabel">
        <input
          id="onboarding-whitelabel"
          type="checkbox"
          checked={state.isWhitelabelRequested}
          onChange={(event) => { setWhitelabel(event.target.checked) }}
          data-testid="onboarding-whitelabel-toggle"
        />
        {t('onboarding.legal.whitelabel_toggle_label')}
      </label>

      {state.isWhitelabelRequested ? (
        <div className="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="onboarding-whitelabel-fields">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-legal-address">
              {t('onboarding.legal.legal_address_label')}
            </label>
            <input
              id="onboarding-legal-address"
              className={inputClassName}
              value={state.legalAddress}
              onChange={setText('legalAddress')}
              data-testid="onboarding-legal-address"
            />
            <FieldError shown={attemptedSubmit && errors.legalAddress !== undefined} t={t} />
          </div>
          <FileUploadField
            label={t('onboarding.legal.registration_certificate_label')}
            required
            value={state.registrationCertificateUrl}
            onUploaded={setRegistrationCertificateUrl}
            t={t}
            testId="onboarding-registration-certificate-upload"
          />
          <FieldError shown={attemptedSubmit && errors.registrationCertificateUrl !== undefined} t={t} />
        </div>
      ) : null}
    </fieldset>
  )
}
