import type { ReactElement } from 'react'
import { useT } from '@dorutj/i18n'

export interface NewOrderBannerProps {
  readonly orderNumber: string | null
  readonly onDismiss: () => void
}

/** Визуальный канал двойного оповещения (SRS-UX-007/025) — мигающий баннер поверх экрана, независимый от звука (звук мог быть недоступен/заглушён устройством). */
export const NewOrderBanner = ({ orderNumber, onDismiss }: NewOrderBannerProps): ReactElement | null => {
  const { t } = useT('tj')
  if (orderNumber === null) return null

  return (
    <div
      role="alert"
      data-testid="new-order-banner"
      className="flex animate-pulse items-center justify-between gap-3 rounded-md bg-brand-primary px-4 py-3 text-sm font-semibold text-white"
    >
      <span>{t('pharmacy.order_queue.new_order_banner.text', { orderNumber })}</span>
      <button
        type="button"
        onClick={onDismiss}
        data-testid="new-order-banner-dismiss"
        className="min-h-[48px] min-w-[48px] rounded-md bg-white/20 px-2"
      >
        {t('pharmacy.order_queue.new_order_banner.dismiss')}
      </button>
    </div>
  )
}
