import { useLocale } from '@/shared/config/locale-provider'
import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, Checkbox } from '@dorutj/ui'

export interface CompletePickingSectionProps {
  /** `canCompletePicking(items, uiState)` — не учитывает чекбокс, только доменную готовность. */
  readonly canComplete: boolean
  readonly sealConfirmed: boolean
  readonly onSealConfirmedChange: (checked: boolean) => void
  readonly onComplete: () => void
  readonly isCompleting: boolean
  readonly errorMessage: string | null
}

/** Чекбокс «Пакет опечатан» — ОБЯЗАТЕЛЬНЫЙ явный элемент, не предзаполнен `true` (DoD DTJ-312). */
export const CompletePickingSection = ({
  canComplete,
  sealConfirmed,
  onSealConfirmedChange,
  onComplete,
  isCompleting,
  errorMessage,
}: CompletePickingSectionProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" data-testid="complete-picking-section">
      <Checkbox
        label={t('pharmacy.picking.complete.seal_checkbox_label')}
        checked={sealConfirmed}
        onChange={onSealConfirmedChange}
      />
      <Button
        variant="primary"
        size="lg"
        disabled={!canComplete || !sealConfirmed}
        loading={isCompleting}
        onClick={onComplete}
        data-testid="complete-picking-cta"
      >
        {t('pharmacy.picking.complete.cta')}
      </Button>
      {errorMessage !== null ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="complete-picking-error">
          {errorMessage}
        </p>
      ) : null}
    </div>
  )
}
