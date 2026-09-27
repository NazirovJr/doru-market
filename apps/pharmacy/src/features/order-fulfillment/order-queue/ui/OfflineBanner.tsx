import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'

export interface OfflineBannerProps {
  readonly visible: boolean
}

/** SRS-UX-025 — «Нет соединения» деградация: пока нет WS (TODO(DTJ-308)), REST-опрос сам себе индикатор связи (см. `orders-queue.api.ts` JSDoc). */
export const OfflineBanner = ({ visible }: OfflineBannerProps): ReactElement | null => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  if (!visible) return null

  return (
    <p role="status" data-testid="order-queue-offline-banner" className="rounded-md bg-brand-warning px-4 py-2 text-sm font-medium text-white">
      {t('pharmacy.order_queue.offline_banner.text')}
    </p>
  )
}
