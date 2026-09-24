import { Fragment, useState, type ReactElement } from 'react'
import { useT, type TranslateFunction } from '@dorutj/i18n'
import type { InventorySyncBatchListItemDto, InventorySyncBatchStatusDto } from '@dorutj/contracts'
import { BatchErrorsAccordion } from '@/features/sync-history/ui/BatchErrorsAccordion'

export interface SyncBatchesTableProps {
  readonly items: readonly InventorySyncBatchListItemDto[]
}

const STATUS_COLOR_CLASS: Readonly<Record<InventorySyncBatchStatusDto, string>> = {
  completed_full_success: 'text-brand-success',
  completed_partial_success: 'text-brand-warning',
  failed_validation: 'text-brand-danger',
  queued: 'text-ink-muted',
  processing: 'text-ink-muted',
}

function statusLabel(t: TranslateFunction, status: InventorySyncBatchStatusDto): string {
  return t(`pharmacy.inventory.sync_history.status.${status}`)
}

function channelLabel(t: TranslateFunction, channel: InventorySyncBatchListItemDto['channel']): string {
  return t(`pharmacy.inventory.sync_history.channel.${channel}`)
}

function syncTypeLabel(t: TranslateFunction, syncType: InventorySyncBatchListItemDto['syncType']): string {
  return t(`pharmacy.inventory.sync_history.sync_type.${syncType}`)
}

function formatDateTime(iso: string | null, placeholder: string): string {
  return iso === null ? placeholder : new Date(iso).toLocaleString()
}

/** Строка раскрываема, только если в батче реально есть построчные ошибки (SRS-INV-044). */
function hasErrors(item: InventorySyncBatchListItemDto): boolean {
  return item.rejectedRows > 0
}

/**
 * `SyncBatchesTable` (DTJ-169, SRS-INV-043/044) — построчный список батчей. Раскрытие ошибок —
 * `Set<batchId>` локального состояния, каждая строка независима (не одна на весь список).
 */
export const SyncBatchesTable = ({ items }: SyncBatchesTableProps): ReactElement => {
  const { t } = useT('tj')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  function toggleExpanded(batchId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(batchId)) {
        next.delete(batchId)
      } else {
        next.add(batchId)
      }
      return next
    })
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted" data-testid="sync-batches-table-empty">
        {t('pharmacy.inventory.sync_history.empty')}
      </p>
    )
  }

  return (
    <table className="w-full text-left text-sm" data-testid="sync-batches-table">
      <thead>
        <tr className="border-b border-line text-ink-muted">
          <th className="py-2 pr-2">{t('pharmacy.inventory.sync_history.table.channel_column')}</th>
          <th className="py-2 pr-2">{t('pharmacy.inventory.sync_history.table.type_column')}</th>
          <th className="py-2 pr-2">{t('pharmacy.inventory.sync_history.table.status_column')}</th>
          <th className="py-2 pr-2">{t('pharmacy.inventory.sync_history.table.accepted_column')}</th>
          <th className="py-2 pr-2">{t('pharmacy.inventory.sync_history.table.rejected_column')}</th>
          <th className="py-2 pr-2">{t('pharmacy.inventory.sync_history.table.received_column')}</th>
          <th className="py-2 pr-2">{t('pharmacy.inventory.sync_history.table.completed_column')}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const rowHasErrors = hasErrors(item)
          const isOpen = expanded.has(item.batchId)
          return (
            <Fragment key={item.batchId}>
              <tr
                className={`border-b border-line ${rowHasErrors ? 'cursor-pointer' : ''}`}
                onClick={rowHasErrors ? () => { toggleExpanded(item.batchId) } : undefined}
                data-testid={`sync-batch-row-${item.batchId}`}
              >
                <td className="py-2 pr-2">{channelLabel(t, item.channel)}</td>
                <td className="py-2 pr-2">{syncTypeLabel(t, item.syncType)}</td>
                <td className={`py-2 pr-2 font-medium ${STATUS_COLOR_CLASS[item.status]}`} data-testid={`sync-batch-status-${item.batchId}`}>
                  {statusLabel(t, item.status)}
                </td>
                <td className="py-2 pr-2">{item.acceptedRows}</td>
                <td className="py-2 pr-2">{item.rejectedRows}</td>
                <td className="py-2 pr-2">{formatDateTime(item.receivedAt, '—')}</td>
                <td className="py-2 pr-2">{formatDateTime(item.completedAt, t('pharmacy.inventory.sync_history.table.completed_pending'))}</td>
              </tr>
              {rowHasErrors ? (
                <tr className="border-b border-line">
                  <td colSpan={7} className="py-2">
                    <BatchErrorsAccordion batch={item} isOpen={isOpen} onToggle={() => { toggleExpanded(item.batchId) }} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
