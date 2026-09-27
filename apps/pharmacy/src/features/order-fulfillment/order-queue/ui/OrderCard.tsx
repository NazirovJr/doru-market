import { useState, type ReactElement } from 'react'
import { Link } from 'react-router'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import type { PharmacyTerminalQueueItemDto } from '@dorutj/contracts'
import { ReclaimMenu } from './ReclaimMenu'

export interface OrderCardProps {
  readonly item: PharmacyTerminalQueueItemDto
  readonly currentUserId: string
  readonly onAccept: (orderId: string) => void
  readonly isAccepting: boolean
}

export const OrderCard = ({ item, currentUserId, onAccept, isAccepting }: OrderCardProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [reclaimOpen, setReclaimOpen] = useState(false)
  const isAssignedToSomeoneElse = item.assignedPharmacistId !== null && item.assignedPharmacistId !== currentUserId

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4" data-testid="order-queue-card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">{item.orderNumber}</p>
        {item.prescriptionRequired ? (
          <span className="rounded-full bg-brand-warning px-2 py-0.5 text-xs font-medium text-white" data-testid="order-card-rx-badge">
            {t('pharmacy.order_queue.card.prescription_badge')}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-ink-muted">
        {t('pharmacy.order_queue.card.items_summary', { count: item.itemsCount, total: item.itemsTotalTjs })}
      </p>
      <p className="text-xs text-ink-muted">{t(`pharmacy.order_queue.payment_method.${item.paymentMethod}`)}</p>

      {item.status === 'processing' ? (
        <ProcessingFooter
          item={item}
          currentUserId={currentUserId}
          isAssignedToSomeoneElse={isAssignedToSomeoneElse}
          reclaimOpen={reclaimOpen}
          onToggleReclaim={() => { setReclaimOpen((open) => !open) }}
        />
      ) : (
        <button
          type="button"
          onClick={() => { onAccept(item.id) }}
          disabled={isAccepting}
          data-testid="order-card-accept-cta"
          className="min-h-[56px] rounded-md bg-brand-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t('pharmacy.order_queue.card.accept_cta')}
        </button>
      )}
    </li>
  )
}

interface ProcessingFooterProps {
  readonly item: PharmacyTerminalQueueItemDto
  readonly currentUserId: string
  readonly isAssignedToSomeoneElse: boolean
  readonly reclaimOpen: boolean
  readonly onToggleReclaim: () => void
}

// Отдельная секция «В сборке» — своя разметка, чтобы не раздувать основной OrderCard условной вложенностью.
const ProcessingFooter = ({ item, currentUserId, isAssignedToSomeoneElse, reclaimOpen, onToggleReclaim }: ProcessingFooterProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  if (!isAssignedToSomeoneElse) {
    const isMine = currentUserId === item.assignedPharmacistId
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-line px-2 py-1 text-xs font-medium text-ink" data-testid="order-card-own-badge">
          {isMine ? t('pharmacy.order_queue.card.assigned_to_me_badge') : t('pharmacy.order_queue.card.assigned_unknown_badge')}
        </span>
        {/* Переход в экран сборки доступен только владельцу — коллега должен сначала перехватить заказ. */}
        {isMine ? (
          <Link
            to={`/orders/${item.id}`}
            data-testid="order-card-go-to-picking"
            className="flex min-h-[48px] items-center rounded-md bg-brand-primary px-3 text-sm font-semibold text-white"
          >
            {t('pharmacy.order_queue.card.go_to_picking_cta')}
          </Link>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-line px-2 py-1 text-xs font-medium text-ink" data-testid="order-card-assigned-badge">
          {t('pharmacy.order_queue.card.assigned_to_colleague_badge', { name: item.assignedPharmacistName ?? t('pharmacy.order_queue.card.unknown_colleague') })}
        </span>
        <button
          type="button"
          onClick={onToggleReclaim}
          data-testid="order-card-reclaim-toggle"
          className="min-h-[48px] min-w-[48px] rounded-md border border-line px-2 text-sm text-ink"
        >
          {t('pharmacy.order_queue.card.reclaim_menu_toggle')}
        </button>
      </div>
      {reclaimOpen ? <ReclaimMenu orderId={item.id} onClose={onToggleReclaim} /> : null}
    </div>
  )
}
