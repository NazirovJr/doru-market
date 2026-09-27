import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import type { PharmacyTerminalOrderDetailDto, PharmacyTerminalOrderItemDto } from '@dorutj/contracts'
import { findNextPendingItemId, isItemActionable } from '@/features/order-fulfillment/model/picking.model'
import { BarcodeScanForm } from './BarcodeScanForm'
import { ReportIssueModal } from './ReportIssueModal'

export interface ItemRowProps {
  readonly order: PharmacyTerminalOrderDetailDto
  readonly item: PharmacyTerminalOrderItemDto
  readonly isSelected: boolean
  readonly onSelect: (itemId: string | null) => void
  /** DTJ-312 доработка — `422 EXPIRED_STOCK.details.itemIds` на `complete-picking`: подсветка позиции, партия которой протухла за время ожидания. */
  readonly isExpiredStock?: boolean
}

// Статус различим без цвета — у каждого состояния своя иконка и свой текст.
const STATUS_GLYPH: Readonly<Record<PharmacyTerminalOrderItemDto['fulfillmentStatus'], string>> = {
  pending: '•',
  scanned_ok: '✓',
  unavailable: '✕',
}

const StatusBadge = ({ item }: { readonly item: PharmacyTerminalOrderItemDto }): ReactElement => {
  const { t } = useT('tj')
  const colorClass =
    item.fulfillmentStatus === 'scanned_ok'
      ? 'text-brand-success'
      : item.fulfillmentStatus === 'unavailable'
        ? 'text-brand-danger'
        : 'text-ink-muted'
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${colorClass}`} data-testid="picking-item-badge">
      <span aria-hidden="true">{STATUS_GLYPH[item.fulfillmentStatus]}</span>
      {t(`pharmacy.picking.item.status.${item.fulfillmentStatus}`)}
      {item.fulfillmentStatus === 'unavailable' && item.itemIssueReason !== null
        ? ` — ${t(`pharmacy.picking.report_issue.reason.${item.itemIssueReason}`)}`
        : null}
    </span>
  )
}

export const ItemRow = ({ order, item, isSelected, onSelect, isExpiredStock = false }: ItemRowProps): ReactElement => {
  const { t } = useT('tj')
  const [reportOpen, setReportOpen] = useState(false)
  const actionable = isItemActionable(item, order)

  return (
    <li
      className={`flex flex-col gap-2 rounded-md border bg-surface p-4 ${isExpiredStock ? 'border-brand-danger' : 'border-line'}`}
      data-testid="picking-item-row"
    >
      {isExpiredStock ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="picking-item-expired-stock-notice">
          {t('pharmacy.picking.item.expired_stock_notice')}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => { onSelect(isSelected ? null : item.id) }}
        disabled={!actionable}
        data-testid="picking-item-select"
        className="flex min-h-[56px] w-full items-center justify-between gap-2 py-2 text-left disabled:opacity-70"
      >
        <span className="flex flex-col gap-1">
          <span className={`text-sm font-semibold text-ink ${item.fulfillmentStatus === 'unavailable' ? 'line-through' : ''}`}>
            {item.medicineName}
          </span>
          <span className="text-xs text-ink-muted">{t('pharmacy.picking.item.quantity', { quantity: item.quantity })}</span>
        </span>
        <StatusBadge item={item} />
      </button>

      {isSelected && actionable ? (
        // Фокус переходит на следующую нерешённую позицию — быстрее сканировать заказ подряд.
        <BarcodeScanForm orderId={order.id} itemId={item.id} onScanned={(resolvedId) => { onSelect(findNextPendingItemId(order.items, resolvedId)) }} />
      ) : null}

      {actionable ? (
        <button
          type="button"
          onClick={() => { setReportOpen(true) }}
          data-testid="picking-item-report-issue"
          className="min-h-[56px] rounded-md border border-brand-danger px-3 text-sm font-medium text-brand-danger"
        >
          {t('pharmacy.picking.item.report_issue_cta')}
        </button>
      ) : null}

      {reportOpen ? <ReportIssueModal orderId={order.id} itemId={item.id} onClose={() => { setReportOpen(false) }} /> : null}
    </li>
  )
}
