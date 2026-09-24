import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import type { InventorySyncBatchListItemDto, InventorySyncRowErrorResponseDto } from '@dorutj/contracts'
import { downloadSyncErrorReport, useBatchRowErrors } from '@/features/sync-history/api/use-sync-batches'

export interface BatchErrorsAccordionProps {
  readonly batch: InventorySyncBatchListItemDto
  readonly isOpen: boolean
  readonly onToggle: () => void
}

interface ErrorsListProps {
  readonly isPending: boolean
  readonly isError: boolean
  readonly rows: readonly InventorySyncRowErrorResponseDto[] | undefined
}

const ErrorsList = ({ isPending, isError, rows }: ErrorsListProps): ReactElement => {
  const { t } = useT('tj')
  if (isPending) {
    return <p className="text-sm text-ink-muted">{t('pharmacy.inventory.sync_history.errors.loading')}</p>
  }
  if (isError) {
    return <p role="alert" className="text-sm text-brand-danger">{t('pharmacy.inventory.sync_history.errors.error')}</p>
  }
  if (rows === undefined || rows.length === 0) {
    return <p className="text-sm text-ink-muted">{t('pharmacy.inventory.sync_history.errors.empty')}</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((rowError) => (
        <li key={rowError.rowIndex} className="text-sm text-ink" data-testid="batch-error-row">
          <span className="font-medium">{t('pharmacy.inventory.sync_history.errors.row_label', { rowIndex: rowError.rowIndex })}:</span>{' '}
          {rowError.message}
        </li>
      ))}
    </ul>
  )
}

interface DownloadReportButtonProps {
  readonly batchId: string
  readonly sourceUploadId: string
}

const DownloadReportButton = ({ batchId, sourceUploadId }: DownloadReportButtonProps): ReactElement => {
  const { t } = useT('tj')
  const [downloadError, setDownloadError] = useState(false)

  function handleDownload(): void {
    setDownloadError(false)
    downloadSyncErrorReport(sourceUploadId).catch(() => { setDownloadError(true) })
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleDownload}
        data-testid={`batch-download-error-report-${batchId}`}
        className="text-sm text-brand-primary underline"
      >
        {t('pharmacy.inventory.sync_history.errors.download_report')}
      </button>
      {downloadError ? (
        <p role="alert" className="text-xs text-brand-danger">
          {t('pharmacy.inventory.sync_history.errors.download_report_error')}
        </p>
      ) : null}
    </div>
  )
}

// useBatchRowErrors грузит /errors только при isOpen=true — не N+1 запросов на список.
export const BatchErrorsAccordion = ({ batch, isOpen, onToggle }: BatchErrorsAccordionProps): ReactElement => {
  const { t } = useT('tj')
  const errorsQuery = useBatchRowErrors(batch.batchId, isOpen)
  const canDownloadReport = batch.sourceUploadId !== null && batch.rejectedRows > 0

  return (
    <div className="flex flex-col gap-2" data-testid={`batch-errors-accordion-${batch.batchId}`}>
      <button
        type="button"
        onClick={onToggle}
        data-testid={`batch-errors-toggle-${batch.batchId}`}
        className="text-left text-sm text-brand-primary underline"
      >
        {t(isOpen ? 'pharmacy.inventory.sync_history.errors.toggle_collapse' : 'pharmacy.inventory.sync_history.errors.toggle_expand')}
      </button>

      {isOpen ? (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid={`batch-errors-panel-${batch.batchId}`}>
          <ErrorsList isPending={errorsQuery.isPending} isError={errorsQuery.isError} rows={errorsQuery.data} />
          {canDownloadReport && batch.sourceUploadId !== null ? (
            <DownloadReportButton batchId={batch.batchId} sourceUploadId={batch.sourceUploadId} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
