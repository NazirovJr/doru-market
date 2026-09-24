import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import {
  downloadImportErrorReport,
  progressFromBatches,
  useImportBatchesPolling,
} from '@/features/inventory-bulk/api/use-excel-import'

export interface ImportProgressBarProps {
  readonly sourceUploadId: string
}

function roundPercent(percent: number): number {
  return Math.round(percent)
}

/**
 * ОДИН агрегированный прогресс-бар на N батчей одной Excel-загрузки (SRS-INV-014, DTJ-168 АС1) —
 * скрывает от пользователя разбивку на батчи, показывает только итог.
 */
export const ImportProgressBar = ({ sourceUploadId }: ImportProgressBarProps): ReactElement => {
  const { t } = useT('tj')
  const [reportError, setReportError] = useState(false)
  const batchesQuery = useImportBatchesPolling(sourceUploadId)
  const batches = batchesQuery.data
  const progress = progressFromBatches(batches)
  const acceptedRows = (batches ?? []).reduce((sum, batch) => sum + batch.acceptedRows, 0)
  const totalRows = (batches ?? []).reduce((sum, batch) => sum + batch.totalRows, 0)
  const rejectedRows = (batches ?? []).reduce((sum, batch) => sum + batch.rejectedRows, 0)

  function handleDownloadErrorReport(): void {
    setReportError(false)
    downloadImportErrorReport(sourceUploadId).catch(() => { setReportError(true) })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="import-progress-bar">
      <p className="text-sm font-medium text-ink">{t('pharmacy.inventory.bulk_edit.progress_title')}</p>

      <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={roundPercent(progress.percent)} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full rounded-full bg-brand-primary transition-[width]"
          style={{ width: `${String(roundPercent(progress.percent))}%` }}
          data-testid="import-progress-fill"
        />
      </div>

      <p className="text-xs text-ink-muted" data-testid="import-progress-percent">
        {roundPercent(progress.percent)}%
      </p>

      {progress.isComplete ? (
        <div className="flex flex-col gap-2" data-testid="import-progress-complete">
          <p className={progress.hasErrors ? 'text-sm text-brand-danger' : 'text-sm text-ink'}>
            {t(
              progress.hasErrors
                ? 'pharmacy.inventory.bulk_edit.progress_done_with_errors'
                : 'pharmacy.inventory.bulk_edit.progress_done_success',
            )}
          </p>
          <p className="text-xs text-ink-muted">
            {t('pharmacy.inventory.bulk_edit.progress_summary', {
              accepted: acceptedRows,
              total: totalRows,
              errors: rejectedRows,
            })}
          </p>
          {progress.hasErrors ? (
            <div>
              <button
                type="button"
                onClick={handleDownloadErrorReport}
                data-testid="import-download-error-report"
                className="text-sm text-brand-primary underline"
              >
                {t('pharmacy.inventory.bulk_edit.progress_download_error_report')}
              </button>
              {reportError ? (
                <p role="alert" className="text-xs text-brand-danger">
                  {t('pharmacy.inventory.bulk_edit.progress_error_report_error')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
