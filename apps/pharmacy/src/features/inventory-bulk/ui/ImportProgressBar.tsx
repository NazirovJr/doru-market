import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, ProgressBar } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import {
  downloadImportErrorReport,
  progressFromBatches,
  useImportBatchesPolling,
} from '@/features/inventory-bulk/api/use-excel-import'

export interface ImportProgressBarProps {
  readonly sourceUploadId: string
}

// Один прогресс-бар на N батчей одной загрузки — скрывает от пользователя разбивку на батчи.
export const ImportProgressBar = ({ sourceUploadId }: ImportProgressBarProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
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
      <ProgressBar value={progress.percent} labelKey="pharmacy.inventory.bulk_edit.progress_title" t={t} />

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
              <Button type="button" variant="ghost" onClick={handleDownloadErrorReport} data-testid="import-download-error-report">
                {t('pharmacy.inventory.bulk_edit.progress_download_error_report')}
              </Button>
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
