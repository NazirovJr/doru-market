import { useLocale } from '@/shared/config/locale-provider'
import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button } from '@dorutj/ui'

export interface PartialFulfillmentBannerProps {
  readonly canPropose: boolean
  readonly isAwaiting: boolean
  readonly onPropose: () => void
  readonly isProposing: boolean
  readonly proposeErrorMessage: string | null
}

/** Given `!canPropose && !isAwaiting` (нечего предлагать/уже разрешилось) — баннер не рендерится. */
export const PartialFulfillmentBanner = ({
  canPropose,
  isAwaiting,
  onPropose,
  isProposing,
  proposeErrorMessage,
}: PartialFulfillmentBannerProps): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)

  if (isAwaiting) {
    return (
      <p role="status" data-testid="partial-fulfillment-awaiting-banner" className="rounded-md bg-line px-3 py-2 text-sm text-ink">
        {t('pharmacy.partial_fulfillment.awaiting_banner')}
      </p>
    )
  }

  if (!canPropose) return null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4" data-testid="partial-fulfillment-propose-banner">
      <Button variant="secondary" onClick={onPropose} loading={isProposing} data-testid="partial-fulfillment-propose-cta">
        {t('pharmacy.partial_fulfillment.propose_cta')}
      </Button>
      {proposeErrorMessage !== null ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="partial-fulfillment-propose-error">
          {proposeErrorMessage}
        </p>
      ) : null}
    </div>
  )
}
