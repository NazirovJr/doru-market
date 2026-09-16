import { useState, type ReactElement } from 'react'
import type { OrderReturnDto } from '@dorutj/contracts'
import { useT, toIntlLocale } from '@dorutj/i18n'
import { useIncomingReturns } from '@/features/returns/api/use-incoming-returns'
import { useRejectReturn } from '@/features/returns/api/use-reject-return'
import { ReturnChecklistForm } from './ReturnChecklistForm'
import { isRejectReasonValid } from './ReturnChecklistForm.model'

/**
 * `IncomingReturnsList` (DTJ-277, EP-11, SRS-RET-011) — очередь возвратов своей аптеки: карточки
 * `return_in_transit` (едут, действия «Принять»/«Отклонить» доступны) и `return_rejected`
 * (ожидают повторной попытки/эскалации диспетчером — read-only здесь, DTJ-277 «Что сделать» п.1).
 *
 * «Отклонить» — ОТДЕЛЬНЫЙ CTA от `ReturnChecklistForm` (не тот же чек-лист, только причина
 * текстом, DTJ-277 «Что сделать» п.3) — `RejectPanel` ниже, не `ReturnChecklistForm.tsx`.
 */

type ActiveAction = { readonly returnId: string; readonly mode: 'confirm' | 'reject' } | null

export const IncomingReturnsList = (): ReactElement => {
  const { t } = useT('tj')
  const query = useIncomingReturns()
  const [activeAction, setActiveAction] = useState<ActiveAction>(null)

  if (query.isPending) {
    return (
      <p className="text-sm text-ink-muted" data-testid="incoming-returns-loading">
        {t('pharmacy.returns.list.loading')}
      </p>
    )
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-brand-danger" data-testid="incoming-returns-error">
        {t('pharmacy.returns.list.error')}
      </p>
    )
  }

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8" data-testid="incoming-returns-list">
      <h1 className="text-lg font-semibold text-ink">{t('pharmacy.returns.page.title')}</h1>
      <ReturnSection
        titleKey="pharmacy.returns.list.section.in_transit"
        emptyKey="pharmacy.returns.list.empty.in_transit"
        items={query.data.inTransit}
        allowActions
        activeAction={activeAction}
        onAction={setActiveAction}
      />
      <ReturnSection
        titleKey="pharmacy.returns.list.section.rejected"
        emptyKey="pharmacy.returns.list.empty.rejected"
        items={query.data.rejected}
        allowActions={false}
        activeAction={activeAction}
        onAction={setActiveAction}
      />
    </section>
  )
}

interface ReturnSectionProps {
  readonly titleKey: string
  readonly emptyKey: string
  readonly items: readonly OrderReturnDto[]
  readonly allowActions: boolean
  readonly activeAction: ActiveAction
  readonly onAction: (action: ActiveAction) => void
}

const ReturnSection = ({ titleKey, emptyKey, items, allowActions, activeAction, onAction }: ReturnSectionProps): ReactElement => {
  const { t } = useT('tj')
  return (
    <div className="flex flex-col gap-3" data-testid="returns-section">
      <h2 className="text-sm font-semibold text-ink-muted">{t(titleKey)}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t(emptyKey)}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <ReturnCard item={item} allowActions={allowActions} activeAction={activeAction} onAction={onAction} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ReturnCardProps {
  readonly item: OrderReturnDto
  readonly allowActions: boolean
  readonly activeAction: ActiveAction
  readonly onAction: (action: ActiveAction) => void
}

function formatRequestedAt(requestedAt: string): string {
  return new Intl.DateTimeFormat(toIntlLocale('tj'), { dateStyle: 'medium' }).format(new Date(requestedAt))
}

const ReturnCard = ({ item, allowActions, activeAction, onAction }: ReturnCardProps): ReactElement => {
  const { t } = useT('tj')
  const isConfirming = activeAction?.returnId === item.id && activeAction.mode === 'confirm'
  const isRejecting = activeAction?.returnId === item.id && activeAction.mode === 'reject'

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4" data-testid="return-card">
      <p className="text-sm font-medium text-ink">{t('pharmacy.returns.card.order_label', { orderId: item.orderId })}</p>
      <p className="text-sm text-ink-muted">{t(`pharmacy.returns.reason.${item.reason}`)}</p>
      <p className="text-xs text-ink-muted">{t('pharmacy.returns.card.requested_at', { date: formatRequestedAt(item.requestedAt) })}</p>

      {allowActions && activeAction === null ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => { onAction({ returnId: item.id, mode: 'confirm' }) }}
            data-testid="return-card-confirm-cta"
            className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white"
          >
            {t('pharmacy.returns.card.confirm_cta')}
          </button>
          <button
            type="button"
            onClick={() => { onAction({ returnId: item.id, mode: 'reject' }) }}
            data-testid="return-card-reject-cta"
            className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink"
          >
            {t('pharmacy.returns.card.reject_cta')}
          </button>
        </div>
      ) : null}

      {isConfirming ? (
        <ReturnChecklistForm
          returnId={item.id}
          {...(item.controlCategory !== undefined && { controlCategory: item.controlCategory })}
          onClose={() => { onAction(null) }}
        />
      ) : null}
      {isRejecting ? <RejectPanel returnId={item.id} onClose={() => { onAction(null) }} /> : null}
    </div>
  )
}

const RejectPanel = ({ returnId, onClose }: { readonly returnId: string; readonly onClose: () => void }): ReactElement => {
  const { t } = useT('tj')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const rejectReturn = useRejectReturn()
  const isValid = isRejectReasonValid(reason)

  function handleSubmit(): void {
    setTouched(true)
    if (!isValid) {
      return
    }
    rejectReturn.mutate({ returnId, reason: reason.trim() }, { onSuccess: onClose })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3" data-testid="reject-panel">
      <label className="flex flex-col gap-1 text-sm text-ink">
        {t('pharmacy.returns.reject.reason_label')}
        <textarea
          value={reason}
          onChange={(event) => { setReason(event.target.value) }}
          rows={2}
          disabled={rejectReturn.isPending}
          data-testid="reject-reason"
          className="rounded-md border border-line px-3 py-2"
        />
      </label>
      {touched && !isValid ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="reject-reason-required">
          {t('pharmacy.returns.reject.reason_required')}
        </p>
      ) : null}
      {rejectReturn.isError ? (
        <p role="alert" className="text-xs text-brand-danger" data-testid="reject-error">
          {t('pharmacy.returns.reject.error')}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={rejectReturn.isPending}
          data-testid="reject-submit"
          className="rounded-md bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {rejectReturn.isPending ? t('pharmacy.returns.reject.submit_pending') : t('pharmacy.returns.reject.submit')}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={rejectReturn.isPending}
          className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink disabled:opacity-50"
        >
          {t('pharmacy.returns.reject.cancel')}
        </button>
      </div>
    </div>
  )
}
