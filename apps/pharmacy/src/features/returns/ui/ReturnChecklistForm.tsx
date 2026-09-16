import { useState, type ReactElement } from 'react'
import type { ControlCategoryPublic, ReturnDisposition } from '@dorutj/contracts'
import { useT } from '@dorutj/i18n'
import { useConfirmReturn } from '@/features/returns/api/use-confirm-return'
import {
  INITIAL_CHECKLIST_STATE,
  buildConfirmChecklistPayload,
  resolvePackagingToggleState,
} from './ReturnChecklistForm.model'

/**
 * `ReturnChecklistForm` (DTJ-277, EP-11, SRS-DOM-053/054) — чек-лист приёмки возврата фармацевтом:
 * `packagingIntact` (временный локальный `Switch` — `packages/ui` не покрывает его дизайном,
 * `32-design-reference.md` «Пробелы дизайна», TODO(EP-18) перенос) + `checklistNotes`
 * (`Textarea`, тоже временный локальный). НЕ включает кнопку «Отклонить» — отдельный CTA вне этой
 * формы, см. `IncomingReturnsList.tsx` (DTJ-277 «Что сделать» п.3).
 *
 * После успешного подтверждения показывает `disposition` РОВНО так, как его вернул сервер — не
 * пересчитывает на клиенте (DTJ-277 «Что сделать» п.4, `SRS-DOM-053/054` — домен уже применил
 * правила восстановления/уничтожения на бэкенде).
 */

const MIN_TAP_ZONE_PX = 48

export interface ReturnChecklistFormProps {
  readonly returnId: string
  readonly controlCategory?: ControlCategoryPublic
  readonly onClose: () => void
}

const DispositionResult = ({ disposition, onClose }: { readonly disposition: ReturnDisposition; readonly onClose: () => void }): ReactElement => {
  const { t } = useT('tj')
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" data-testid="checklist-result">
      <p className="text-sm font-semibold text-ink">{t('pharmacy.returns.checklist.result.title')}</p>
      <p className="text-sm text-ink" data-testid="checklist-result-disposition">
        {t(`pharmacy.returns.checklist.result.${disposition}`)}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="self-start rounded-md border border-line px-3 py-2 text-sm font-medium text-ink"
      >
        {t('pharmacy.returns.checklist.close')}
      </button>
    </div>
  )
}

export const ReturnChecklistForm = ({ returnId, controlCategory, onClose }: ReturnChecklistFormProps): ReactElement => {
  const { t } = useT('tj')
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

      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={toggle.value}
          disabled={toggle.locked || confirmReturn.isPending}
          data-testid="checklist-packaging-toggle"
          onClick={() => { setState((prev) => ({ ...prev, packagingIntact: !prev.packagingIntact })) }}
          style={{ minHeight: MIN_TAP_ZONE_PX / 2 }}
          className={`relative inline-flex h-7 w-12 items-center rounded-full border border-line transition disabled:cursor-not-allowed disabled:opacity-60 ${toggle.value ? 'bg-brand-primary' : 'bg-surface'}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white transition ${toggle.value ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
        <span className="text-sm text-ink">{t('pharmacy.returns.checklist.packaging_label')}</span>
      </div>
      {toggle.locked ? (
        <p className="text-xs text-brand-danger" data-testid="checklist-packaging-locked-hint">
          {t('pharmacy.returns.checklist.packaging_locked_hint')}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm text-ink">
        {t('pharmacy.returns.checklist.notes_label')}
        <textarea
          value={state.notes}
          onChange={(event) => { setState((prev) => ({ ...prev, notes: event.target.value })) }}
          placeholder={t('pharmacy.returns.checklist.notes_placeholder')}
          rows={3}
          disabled={confirmReturn.isPending}
          data-testid="checklist-notes"
          className="rounded-md border border-line px-3 py-2"
        />
      </label>

      {confirmReturn.isError ? (
        <p role="alert" className="text-sm text-brand-danger" data-testid="checklist-error">
          {t('pharmacy.returns.checklist.error')}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={confirmReturn.isPending}
          data-testid="checklist-submit"
          style={{ minHeight: MIN_TAP_ZONE_PX }}
          className="inline-flex flex-1 items-center justify-center rounded-md bg-brand-primary px-4 font-semibold text-white disabled:opacity-50"
        >
          {confirmReturn.isPending ? t('pharmacy.returns.checklist.submit_pending') : t('pharmacy.returns.checklist.submit')}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={confirmReturn.isPending}
          data-testid="checklist-cancel"
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
        >
          {t('pharmacy.returns.checklist.cancel')}
        </button>
      </div>
    </div>
  )
}
