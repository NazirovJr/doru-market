// periodDays > 31 переключает на polling — сегодняшние потребители всегда <= 31, ветка проверена только тестами с ручным триггером.
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Button, ProgressBar, useToast } from '@dorutj/ui'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { httpRequest } from '@/shared/api/http-client'

const SYNC_EXPORT_MAX_PERIOD_DAYS = 31
const POLL_INTERVAL_MS = 2_000

export interface ReportExportColumn {
  readonly key: string
  readonly header: string
}

export interface ReportExportButtonProps {
  readonly reportType: string
  readonly periodDays: number
  readonly params?: Readonly<Record<string, string>>
  readonly rows: readonly Record<string, unknown>[]
  readonly columns: readonly ReportExportColumn[]
  readonly fileBaseName: string
}

type ExportFormat = 'csv' | 'xlsx'

interface ExportJobStatusBody {
  readonly data: { readonly status: 'processing' | 'ready' | 'failed'; readonly downloadUrl?: string }
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export const ReportExportButton = ({ reportType, periodDays, params, rows, columns, fileBaseName }: ReportExportButtonProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const toast = useToast()
  const [loadingFormat, setLoadingFormat] = useState<ExportFormat | null>(null)
  const [pollingExportJobId, setPollingExportJobId] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => () => { clearInterval(pollTimerRef.current) }, [])

  const isSync = periodDays <= SYNC_EXPORT_MAX_PERIOD_DAYS
  const isDisabled = isSync && rows.length === 0

  async function requestExport(format: ExportFormat): Promise<void> {
    setLoadingFormat(format)
    try {
      const body = isSync ? { periodDays, params: params ?? {}, rows, columns } : { periodDays, params: params ?? {} }
      const response = await httpRequest(`/api/v1/reports/${reportType}/export?format=${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        throw new Error(`export request failed: ${String(response.status)}`)
      }
      if (isSync) {
        triggerBrowserDownload(await response.blob(), `${fileBaseName}.${format}`)
        return
      }
      const accepted = (await response.json()) as { readonly data: { readonly exportJobId: string } }
      setPollingExportJobId(accepted.data.exportJobId)
      startPolling(accepted.data.exportJobId)
    } catch {
      toast.error(t('admin.report_export.error'))
    } finally {
      setLoadingFormat(null)
    }
  }

  function startPolling(exportJobId: string): void {
    clearInterval(pollTimerRef.current)
    pollTimerRef.current = setInterval(() => {
      void pollOnce(exportJobId)
    }, POLL_INTERVAL_MS)
  }

  async function pollOnce(exportJobId: string): Promise<void> {
    const response = await httpRequest(`/api/v1/reports/export-jobs/${exportJobId}`)
    if (!response.ok) {
      return
    }
    const body = (await response.json()) as ExportJobStatusBody
    if (body.data.status === 'processing') {
      return
    }
    clearInterval(pollTimerRef.current)
    setPollingExportJobId(null)
    if (body.data.status === 'ready' && body.data.downloadUrl !== undefined) {
      window.open(body.data.downloadUrl, '_blank', 'noopener,noreferrer')
      return
    }
    toast.error(t('admin.report_export.error'))
  }

  if (pollingExportJobId !== null) {
    return (
      <div data-testid="report-export-progress">
        <ProgressBar value={0} labelKey="admin.report_export.processing" t={t} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="secondary" size="md" loading={loadingFormat === 'csv'} disabled={isDisabled} onClick={() => { void requestExport('csv') }}>
        {t('admin.report_export.button.csv')}
      </Button>
      <Button variant="secondary" size="md" loading={loadingFormat === 'xlsx'} disabled={isDisabled} onClick={() => { void requestExport('xlsx') }}>
        {t('admin.report_export.button.xlsx')}
      </Button>
    </div>
  )
}
