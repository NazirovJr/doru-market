import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useLocale } from '@/shared/config/locale-provider'
import { REPORT_ITEM_ISSUE_REASON_VALUES, type ReportItemIssueReason } from '@dorutj/contracts'
import { useReportItemIssue } from '@/features/order-fulfillment/api/order-items.api'

export interface ReportIssueModalProps {
  readonly orderId: string
  readonly itemId: string
  readonly onClose: () => void
}

/** Чипы причин — контракт несёт три значения, без литерала "other"; заметка покрывает остальные случаи. */
export const ReportIssueModal = ({ orderId, itemId, onClose }: ReportIssueModalProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [reason, setReason] = useState<ReportItemIssueReason | null>(null)
  const [note, setNote] = useState('')
  const reportIssue = useReportItemIssue(orderId)

  function handleSubmit(): void {
    if (reason === null) return
    const trimmedNote = note.trim()
    reportIssue.mutate(
      { itemId, reason, idempotencyKey: crypto.randomUUID(), ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}) },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="report-issue-title" data-testid="report-issue-modal" className="flex w-full max-w-sm flex-col gap-3 rounded-md bg-surface p-4">
        <p id="report-issue-title" className="text-sm font-semibold text-ink">{t('pharmacy.picking.report_issue.title')}</p>

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('pharmacy.picking.report_issue.reason_label')}>
          {REPORT_ITEM_ISSUE_REASON_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={reason === value}
              onClick={() => { setReason(value) }}
              data-testid={`report-issue-reason-${value}`}
              className={`min-h-[48px] rounded-full border px-3 text-sm font-medium ${
                reason === value ? 'border-brand-primary bg-brand-primary text-white' : 'border-line text-ink'
              }`}
            >
              {t(`pharmacy.picking.report_issue.reason.${value}`)}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          {t('pharmacy.picking.report_issue.note_label')}
          <textarea
            value={note}
            onChange={(event) => { setNote(event.target.value) }}
            data-testid="report-issue-note"
            rows={2}
            className="rounded-md border border-line px-2 py-1 text-sm text-ink"
          />
        </label>

        {reportIssue.isError ? (
          <p role="alert" className="text-xs text-brand-danger" data-testid="report-issue-error">
            {t('pharmacy.picking.report_issue.error')}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={reason === null || reportIssue.isPending}
            data-testid="report-issue-submit"
            className="min-h-[56px] flex-1 rounded-md bg-brand-danger px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {reportIssue.isPending ? t('pharmacy.picking.report_issue.submit_pending') : t('pharmacy.picking.report_issue.submit')}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={reportIssue.isPending}
            data-testid="report-issue-cancel"
            className="min-h-[56px] rounded-md border border-line px-3 text-sm text-ink disabled:opacity-50"
          >
            {t('pharmacy.picking.report_issue.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
