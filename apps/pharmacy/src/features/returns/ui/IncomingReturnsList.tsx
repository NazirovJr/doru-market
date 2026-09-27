import { useState, type ReactElement } from 'react'
import type { OrderReturnDto } from '@dorutj/contracts'
import { useT, toIntlLocale, type Locale, type TranslationKey } from '@dorutj/i18n'
import { Button, Card, EmptyState, ErrorState, Skeleton, Textarea } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
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
  const { locale } = useLocale()
  const { t } = useT(locale)
  const query = useIncomingReturns()
  const [activeAction, setActiveAction] = useState<ActiveAction>(null)

  if (query.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 py-8" data-testid="incoming-returns-loading">
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <div data-testid="incoming-returns-error">
        <ErrorState t={t} titleKey="pharmacy.returns.list.error" variant="inline" />
      </div>
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
        locale={locale}
      />
      <ReturnSection
        titleKey="pharmacy.returns.list.section.rejected"
        emptyKey="pharmacy.returns.list.empty.rejected"
        items={query.data.rejected}
        allowActions={false}
        activeAction={activeAction}
        onAction={setActiveAction}
        locale={locale}
      />
    </section>
  )
}

interface ReturnSectionProps {
  readonly titleKey: TranslationKey
  readonly emptyKey: TranslationKey
  readonly items: readonly OrderReturnDto[]
  readonly allowActions: boolean
  readonly activeAction: ActiveAction
  readonly onAction: (action: ActiveAction) => void
  readonly locale: Locale
}

const ReturnSection = ({ titleKey, emptyKey, items, allowActions, activeAction, onAction, locale }: ReturnSectionProps): ReactElement => {
  const { t } = useT(locale)
  return (
    <div className="flex flex-col gap-3" data-testid="returns-section">
      <h2 className="text-sm font-semibold text-ink-muted">{t(titleKey)}</h2>
      {items.length === 0 ? (
        <EmptyState t={t} titleKey={emptyKey} />
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

function formatRequestedAt(requestedAt: string, locale: Locale): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), { dateStyle: 'medium' }).format(new Date(requestedAt))
}

const ReturnCard = ({ item, allowActions, activeAction, onAction }: ReturnCardProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const isConfirming = activeAction?.returnId === item.id && activeAction.mode === 'confirm'
  const isRejecting = activeAction?.returnId === item.id && activeAction.mode === 'reject'

  return (
    // `Card` (packages/ui) не принимает `data-testid` (фиксированный набор пропов) — обёртка.
    <div data-testid="return-card">
      <Card className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">{t('pharmacy.returns.card.order_label', { orderId: item.orderId })}</p>
        <p className="text-sm text-ink-muted">{t(`pharmacy.returns.reason.${item.reason}`)}</p>
        <p className="text-xs text-ink-muted">{t('pharmacy.returns.card.requested_at', { date: formatRequestedAt(item.requestedAt, locale) })}</p>

        {allowActions && activeAction === null ? (
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              onClick={() => { onAction({ returnId: item.id, mode: 'confirm' }) }}
              data-testid="return-card-confirm-cta"
            >
              {t('pharmacy.returns.card.confirm_cta')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { onAction({ returnId: item.id, mode: 'reject' }) }}
              data-testid="return-card-reject-cta"
            >
              {t('pharmacy.returns.card.reject_cta')}
            </Button>
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
      </Card>
    </div>
  )
}

const RejectPanel = ({ returnId, onClose }: { readonly returnId: string; readonly onClose: () => void }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
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
      <Textarea
        label={t('pharmacy.returns.reject.reason_label')}
        value={reason}
        onChange={(event) => { setReason(event.target.value) }}
        rows={2}
        disabled={rejectReturn.isPending}
        data-testid="reject-reason"
      />
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
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={rejectReturn.isPending}
          loading={rejectReturn.isPending}
          data-testid="reject-submit"
        >
          {t('pharmacy.returns.reject.submit')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} disabled={rejectReturn.isPending} data-testid="reject-cancel">
          {t('pharmacy.returns.reject.cancel')}
        </Button>
      </div>
    </div>
  )
}
