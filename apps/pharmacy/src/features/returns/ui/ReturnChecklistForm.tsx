import { useState, type ReactElement } from 'react'
import type { ControlCategoryPublic, ReturnDisposition } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { Button, Switch, Textarea } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useConfirmReturn } from '@/features/returns/api/use-confirm-return'
import {
  INITIAL_CHECKLIST_STATE,
  buildConfirmChecklistPayload,
  resolvePackagingToggleState,
} from './ReturnChecklistForm.model'

/**
 * `ReturnChecklistForm` (DTJ-277, EP-11, SRS-DOM-053/054, DTJ-433) — чек-лист приёмки возврата
 * фармацевтом: `packagingIntact` — `packages/ui` `Switch` (DTJ-405), `checklistNotes` —
 * `packages/ui` `Textarea` (DTJ-404). НЕ включает кнопку «Отклонить» — отдельный CTA вне этой
 * формы, см. `IncomingReturnsList.tsx` (DTJ-277 «Что сделать» п.3).
 *
 * После успешного подтверждения показывает `disposition` РОВНО так, как его вернул сервер — не
 * пересчитывает на клиенте (DTJ-277 «Что сделать» п.4, `SRS-DOM-053/054` — домен уже применил
 * правила восстановления/уничтожения на бэкенде).
 */

export interface ReturnChecklistFormProps {
  readonly returnId: string
  readonly controlCategory?: ControlCategoryPublic
  readonly onClose: () => void
}

const DispositionResult = ({ disposition, onClose }: { readonly disposition: ReturnDisposition; readonly onClose: () => void }): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" data-testid="checklist-result">
      <p className="text-sm font-semibold text-ink">{t('pharmacy.returns.checklist.result.title')}</p>
      <p className="text-sm text-ink" data-testid="checklist-result-disposition">
        {t(`pharmacy.returns.checklist.result.${disposition}`)}
      </p>
      <Button type="button" variant="secondary" onClick={onClose}>
        {t('pharmacy.returns.checklist.close')}
      </Button>
    </div>
  )
}

export const ReturnChecklistForm = ({ returnId, controlCategory, onClose }: ReturnChecklistFormProps): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [state, setState] = useState(INITIAL_CHECKLIST_STATE)
  const confirmReturn = useConfirmReturn()

  const toggle = resolvePackagingToggleState(controlCategory, state.packagingIntact)

  if (confirmReturn.isSuccess) {
    return <DispositionResult disposition={confirmReturn.data.disposition ?? 'pending_inspection'} onClose={onClose} />
  }

  function handleSubmit(): void {
    confirmReturn.mutate({ returnId, checklist: buildConfirmChecklistPayload(controlCategory, state) })
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" data-testid="return-checklist-form">
      <p className="text-sm font-semibold text-ink">{t('pharmacy.returns.checklist.title')}</p>

      <Switch
        label={t('pharmacy.returns.checklist.packaging_label')}
        checked={toggle.value}
        disabled={toggle.locked || confirmReturn.isPending}
        onChange={() => { setState((prev) => ({ ...prev, packagingIntact: !prev.packagingIntact })) }}
      />
      {toggle.locked ? (
        <p className="text-xs text-brand-danger" data-testid="checklist-packaging-locked-hint">
          {t('pharmacy.returns.checklist.packaging_locked_hint')}
        </p>
      ) : null}

      <Textarea
        label={t('pharmacy.returns.checklist.notes_label')}
        value={state.notes}
        onChange={(event) => { setState((prev) => ({ ...prev, notes: event.target.value })) }}
        placeholder={t('pharmacy.returns.checklist.notes_placeholder')}
        rows={3}
        disabled={confirmReturn.isPending}
        data-testid="checklist-notes"
      />

      {confirmReturn.isError ? (
        <p role="alert" className="text-sm text-brand-danger" data-testid="checklist-error">
          {t('pharmacy.returns.checklist.error')}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={confirmReturn.isPending}
          loading={confirmReturn.isPending}
          data-testid="checklist-submit"
          style={{ flex: 1 }}
        >
          {t('pharmacy.returns.checklist.submit')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          disabled={confirmReturn.isPending}
          data-testid="checklist-cancel"
        >
          {t('pharmacy.returns.checklist.cancel')}
        </Button>
      </div>
    </div>
  )
}
