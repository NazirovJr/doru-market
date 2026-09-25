import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { RECLAIM_ORDER_REASON_VALUES, type ReclaimOrderReason } from '@dorutj/contracts'
import { useReclaimOrder } from '@/features/order-fulfillment/api/orders-queue.api'

export interface ReclaimMenuProps {
  readonly orderId: string
  readonly onClose: () => void
}

/** «Перехватить» (карточка «В сборке», занятая коллегой, «Что сделать» п.1) — компактный выбор причины, не полноценный модал, чтобы не раздувать карточку списка. */
export const ReclaimMenu = ({ orderId, onClose }: ReclaimMenuProps): ReactElement => {
  const { t } = useT('tj')
  const [reason, setReason] = useState<ReclaimOrderReason>('colleague_unavailable')
  const reclaimOrder = useReclaimOrder()

  function handleSubmit(): void {
    reclaimOrder.mutate({ orderId, reason, idempotencyKey: crypto.randomUUID() }, { onSuccess: onClose })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3" data-testid="reclaim-menu">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        {t('pharmacy.order_queue.reclaim.reason_label')}
        <select
          value={reason}
          onChange={(event) => { setReason(event.target.value as ReclaimOrderReason) }}
          data-testid="reclaim-reason-select"
          className="min-h-[48px] rounded-md border border-line px-2 text-sm text-ink"
        >
          {RECLAIM_ORDER_REASON_VALUES.map((value) => (
            <option key={value} value={value}>
              {t(`pharmacy.order_queue.reclaim.reason.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {reclaimOrder.isError ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="reclaim-error">
          {t('pharmacy.order_queue.reclaim.error')}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={reclaimOrder.isPending}
          data-testid="reclaim-submit"
          className="min-h-[48px] flex-1 rounded-md bg-brand-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {reclaimOrder.isPending ? t('pharmacy.order_queue.reclaim.submit_pending') : t('pharmacy.order_queue.reclaim.submit')}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={reclaimOrder.isPending}
          data-testid="reclaim-cancel"
          className="min-h-[48px] rounded-md border border-line px-3 text-sm text-ink disabled:opacity-50"
        >
          {t('pharmacy.order_queue.reclaim.cancel')}
        </button>
      </div>
    </div>
  )
}
