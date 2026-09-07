import type { ChangeEvent, ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'
import type { OnboardingFormErrors, OnboardingFormState, OnboardingTextField } from '../model/onboarding-form.model'
import { FileUploadField } from './file-upload-field'
import { FieldError, inputClassName } from './form-field'

/**
 * `pharmacy-details-section.tsx` (DTJ-076, «Что сделать» §1/2/4) — раздел «Аптека (точка)»:
 * поля `SubmitPharmacyApplicationRequestSchema` + загрузка скана лицензии (AC3). Вынесен из
 * `pharmacy-application-form.tsx` отдельным компонентом (см. JSDoc `legal-entity-section.tsx`).
 */
export interface PharmacyDetailsSectionProps {
  readonly state: OnboardingFormState
  readonly errors: OnboardingFormErrors
  readonly attemptedSubmit: boolean
  readonly setField: (field: OnboardingTextField, value: string) => void
  readonly setLicenseScanUrl: (url: string | null) => void
  readonly t: TranslateFunction
}

export const PharmacyDetailsSection = ({
  state,
  errors,
  attemptedSubmit,
  setField,
  setLicenseScanUrl,
  t,
}: PharmacyDetailsSectionProps): ReactElement => {
  const setText = (field: OnboardingTextField) => (event: ChangeEvent<HTMLInputElement>): void => {
    setField(field, event.target.value)
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold text-ink">{t('onboarding.pharmacy.title')}</legend>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-pharmacy-name">
          {t('onboarding.pharmacy.name_label')}
        </label>
        <input
          id="onboarding-pharmacy-name"
          className={inputClassName}
          value={state.name}
          onChange={setText('name')}
          data-testid="onboarding-pharmacy-name"
        />
        <FieldError shown={attemptedSubmit && errors.name !== undefined} t={t} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-pharmacy-address">
          {t('onboarding.pharmacy.address_label')}
        </label>
        <input
          id="onboarding-pharmacy-address"
          className={inputClassName}
          value={state.addressText}
          onChange={setText('addressText')}
          data-testid="onboarding-pharmacy-address"
        />
        <FieldError shown={attemptedSubmit && errors.addressText !== undefined} t={t} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-license-number">
          {t('onboarding.pharmacy.license_number_label')}
        </label>
        <input
          id="onboarding-license-number"
          className={inputClassName}
          value={state.licenseNumber}
          onChange={setText('licenseNumber')}
          data-testid="onboarding-license-number"
        />
        <FieldError shown={attemptedSubmit && errors.licenseNumber !== undefined} t={t} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-license-expiry-date">
          {t('onboarding.pharmacy.license_expiry_date_label')}
        </label>
        <input
          id="onboarding-license-expiry-date"
          type="date"
          className={inputClassName}
          value={state.licenseExpiryDate}
          onChange={setText('licenseExpiryDate')}
          data-testid="onboarding-license-expiry-date"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink" htmlFor="onboarding-pharmacist-in-charge">
          {t('onboarding.pharmacy.pharmacist_in_charge_label')}
        </label>
        <input
          id="onboarding-pharmacist-in-charge"
          className={inputClassName}
          value={state.pharmacistInChargeName}
          onChange={setText('pharmacistInChargeName')}
          data-testid="onboarding-pharmacist-in-charge"
        />
        <FieldError shown={attemptedSubmit && errors.pharmacistInChargeName !== undefined} t={t} />
      </div>

      <FileUploadField
        label={t('onboarding.pharmacy.license_scan_label')}
        value={state.licenseScanUrl}
        onUploaded={setLicenseScanUrl}
        t={t}
        testId="onboarding-license-scan-upload"
      />
    </fieldset>
  )
}
