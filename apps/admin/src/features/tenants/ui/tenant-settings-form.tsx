// Форма отправляет ПОЛНОЕ состояние (не diff) — brandPalette сохраняет нередактируемые ключи.
import { useEffect, useState, type ChangeEvent, type Dispatch, type ReactElement, type SetStateAction, type SyntheticEvent } from 'react'
import { useParams } from 'react-router'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import { ADMIN_LOCALE } from '@/shared/config/locale'
import { useTenant, useUpdateTenantSettings, type UpdateTenantSettingsInput } from '../api/use-tenants'

const PALETTE_PRIMARY_KEY = '--brand-primary'
const PALETTE_SECONDARY_KEY = '--brand-secondary'
const PALETTE_ACCENT_KEY = '--brand-accent'
const PALETTE_KEYS = [PALETTE_PRIMARY_KEY, PALETTE_SECONDARY_KEY, PALETTE_ACCENT_KEY]
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

interface ValidationErrors {
  readonly palette?: string
  readonly codLimitDiram?: string
}

// Блокирует отправку ДО запроса — сервер валидирует то же, но с задержкой на round-trip.
function validateDraft(draft: FormDraft): ValidationErrors {
  const errors: { palette?: string; codLimitDiram?: string } = {}
  const hasInvalidHex = PALETTE_KEYS.some((key) => {
    const value = draft.palette[key]
    return value !== undefined && value.length > 0 && !HEX_COLOR_PATTERN.test(value)
  })
  if (hasInvalidHex) {
    errors.palette = 'admin.tenants.settings_form.validation.invalid_hex'
  }
  const cod = Number(draft.codLimitDiram)
  if (!Number.isInteger(cod) || cod < 0) {
    errors.codLimitDiram = 'admin.tenants.settings_form.validation.invalid_cod_limit'
  }
  return errors
}

interface FormDraft {
  readonly brandName: string
  readonly brandLogoUrl: string
  readonly palette: Readonly<Record<string, string>>
  readonly codLimitDiram: string
  readonly holdPeriodDays: string
}

function draftFromDetail(detail: {
  readonly brandName: string
  readonly brandLogoUrl: string | null
  readonly brandPalette: Readonly<Record<string, string>>
  readonly codLimitDiram: number
  readonly holdPeriodDays: number
}): FormDraft {
  return {
    brandName: detail.brandName,
    brandLogoUrl: detail.brandLogoUrl ?? '',
    palette: detail.brandPalette,
    codLimitDiram: String(detail.codLimitDiram),
    holdPeriodDays: String(detail.holdPeriodDays),
  }
}

export const TenantSettingsForm = (): ReactElement => {
  const { t } = useT(ADMIN_LOCALE)
  const { tenantId } = useParams<{ tenantId: string }>()
  const query = useTenant(tenantId)
  const mutation = useUpdateTenantSettings()
  const [draft, setDraft] = useState<FormDraft | null>(null)

  useEffect(() => {
    if (query.data !== undefined) {
      setDraft(draftFromDetail(query.data))
    }
  }, [query.data])

  if (tenantId === undefined || query.error !== null) {
    return <p role="alert">{t('admin.tenants.settings_form.error')}</p>
  }
  if (query.isLoading || draft === null) {
    return <p role="status">{t('admin.tenants.settings_form.loading')}</p>
  }

  return (
    <TenantSettingsFields
      tenantId={tenantId}
      draft={draft}
      setDraft={setDraft}
      mutation={mutation}
      t={t}
    />
  )
}

interface TenantSettingsFieldsProps {
  readonly tenantId: string
  readonly draft: FormDraft
  readonly setDraft: Dispatch<SetStateAction<FormDraft | null>>
  readonly mutation: ReturnType<typeof useUpdateTenantSettings>
  readonly t: TranslateFunction
}

const TenantSettingsFields = ({ tenantId, draft, setDraft, mutation, t }: TenantSettingsFieldsProps): ReactElement => {
  const fieldError = typeof mutation.error?.details?.field === 'string' ? mutation.error.details.field : null
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({})

  function updateField<K extends keyof FormDraft>(key: K, value: FormDraft[K]): void {
    setDraft((prev) => (prev === null ? prev : { ...prev, [key]: value }))
  }

  function updatePaletteKey(key: string, value: string): void {
    setDraft((prev) => (prev === null ? prev : { ...prev, palette: { ...prev.palette, [key]: value } }))
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault()
    const errors = validateDraft(draft)
    setValidationErrors(errors)
    if (errors.palette !== undefined || errors.codLimitDiram !== undefined) {
      return
    }
    mutation.mutate(toMutationInput(tenantId, draft))
  }

  return (
    <section data-testid="tenant-settings-form-page">
      <h1>{t('admin.tenants.settings_form.title')}</h1>
      <form onSubmit={handleSubmit} data-testid="tenant-settings-form">
        <label>
          {t('admin.tenants.settings_form.field.brand_name')}
          <input
            value={draft.brandName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { updateField('brandName', e.target.value) }}
            required
            aria-invalid={fieldError === 'brandName'}
          />
        </label>
        <label>
          {t('admin.tenants.settings_form.field.brand_logo_url')}
          <input
            value={draft.brandLogoUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { updateField('brandLogoUrl', e.target.value) }}
            aria-invalid={fieldError === 'brandLogoUrl'}
          />
        </label>
        <PaletteFields draft={draft} updatePaletteKey={updatePaletteKey} hasError={validationErrors.palette !== undefined} t={t} />
        {validationErrors.palette !== undefined ? <p role="alert">{t(validationErrors.palette)}</p> : null}
        <label>
          {t('admin.tenants.settings_form.field.cod_limit_diram')}
          <input
            type="number"
            value={draft.codLimitDiram}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { updateField('codLimitDiram', e.target.value) }}
            aria-invalid={fieldError === 'codLimitDiram' || validationErrors.codLimitDiram !== undefined}
          />
        </label>
        {validationErrors.codLimitDiram !== undefined ? <p role="alert">{t(validationErrors.codLimitDiram)}</p> : null}
        <label>
          {t('admin.tenants.settings_form.field.hold_period_days')}
          <input
            type="number"
            value={draft.holdPeriodDays}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { updateField('holdPeriodDays', e.target.value) }}
            aria-invalid={fieldError === 'holdPeriodDays'}
          />
        </label>
        <button type="submit" disabled={mutation.isPending}>
          {t('admin.tenants.settings_form.submit')}
        </button>
      </form>
      {mutation.isSuccess ? <p role="status">{t('admin.tenants.settings_form.toast_success')}</p> : null}
      {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
    </section>
  )
}

interface PaletteFieldsProps {
  readonly draft: FormDraft
  readonly updatePaletteKey: (key: string, value: string) => void
  readonly hasError: boolean
  readonly t: TranslateFunction
}

const PALETTE_FIELD_LABELS: readonly [key: string, labelKey: string][] = [
  [PALETTE_PRIMARY_KEY, 'admin.tenants.settings_form.field.palette_primary'],
  [PALETTE_SECONDARY_KEY, 'admin.tenants.settings_form.field.palette_secondary'],
  [PALETTE_ACCENT_KEY, 'admin.tenants.settings_form.field.palette_accent'],
]

const PaletteFields = ({ draft, updatePaletteKey, hasError, t }: PaletteFieldsProps): ReactElement => (
  <>
    {PALETTE_FIELD_LABELS.map(([key, labelKey]) => (
      <label key={key}>
        {t(labelKey)}
        <input
          value={draft.palette[key] ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { updatePaletteKey(key, e.target.value) }}
          aria-invalid={hasError}
        />
      </label>
    ))}
  </>
)

function toMutationInput(tenantId: string, draft: FormDraft): UpdateTenantSettingsInput {
  const brandPalette = Object.fromEntries(Object.entries(draft.palette).filter(([, value]) => value.length > 0))
  return {
    tenantId,
    patch: {
      brandName: draft.brandName,
      brandLogoUrl: draft.brandLogoUrl.length === 0 ? null : draft.brandLogoUrl,
      brandPalette,
      codLimitDiram: Number(draft.codLimitDiram),
      holdPeriodDays: Number(draft.holdPeriodDays),
    },
  }
}
