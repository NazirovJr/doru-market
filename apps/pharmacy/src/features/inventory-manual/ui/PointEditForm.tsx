import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { useT } from '@dorutj/i18n'
import { useManualEntry } from '@/features/inventory-manual/api/use-manual-entry'
import type { MedicineSuggestionItem } from '@/features/inventory-manual/api/use-medicine-suggest'
import {
  INITIAL_POINT_EDIT_STATE,
  buildManualEntryRow,
  isPointEditFormValid,
  resolveManualEntryErrorKey,
  validatePointEditForm,
  type PointEditFormState,
} from '@/features/inventory-manual/model/manual-entry-form.model'
import { MedicineAutocomplete } from './MedicineAutocomplete'

/** Тап-зона кабинета аптеки, `32-design-reference.md`. */
const MIN_TAP_ZONE_PX = 56
const TOAST_SUCCESS_AUTO_CLOSE_MS = 4000

type ToastState = { readonly kind: 'success' } | { readonly kind: 'error'; readonly messageKey: string } | null

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 'YYYY-MM-DD'.length)
}

// TODO(DTJ-406): заменить на Toast из packages/ui, когда он появится.
const Toast = ({ state, onClose }: { readonly state: ToastState; readonly onClose: () => void }): ReactElement | null => {
  const { t } = useT('tj')

  useEffect(() => {
    if (state?.kind !== 'success') {
      return undefined
    }
    const timeoutId = setTimeout(onClose, TOAST_SUCCESS_AUTO_CLOSE_MS)
    return () => {
      clearTimeout(timeoutId)
    }
  }, [state, onClose])

  if (state === null) {
    return null
  }
  const isError = state.kind === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      data-testid={isError ? 'manual-entry-toast-error' : 'manual-entry-toast-success'}
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${isError ? 'border-brand-danger text-brand-danger' : 'border-line text-ink'}`}
    >
      <span>{isError ? t(state.messageKey) : t('pharmacy.inventory.point_edit.toast_success')}</span>
      {isError ? (
        <button type="button" onClick={onClose} data-testid="manual-entry-toast-dismiss" className="text-xs font-semibold underline">
          {t('pharmacy.inventory.point_edit.toast_dismiss')}
        </button>
      ) : null}
    </div>
  )
}

const FormField = ({
  label,
  error,
  errorTestId,
  children,
}: {
  readonly label: string
  readonly error?: string | undefined
  readonly errorTestId?: string | undefined
  readonly children: ReactNode
}): ReactElement => {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-ink">{label}</label>
      {children}
      {error !== undefined ? (
        <p role="alert" data-testid={errorTestId} className="text-xs text-brand-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

const INPUT_CLASS_NAME = 'rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink'

export const PointEditForm = (): ReactElement => {
  const { t } = useT('tj')
  // Смена key ремаунтит автокомплит — проще, чем синхронизировать его внутренний текст.
  const [formKey, setFormKey] = useState(0)
  const [medicine, setMedicine] = useState<MedicineSuggestionItem | null>(null)
  const [form, setForm] = useState<PointEditFormState>(INITIAL_POINT_EDIT_STATE)
  const [toast, setToast] = useState<ToastState>(null)
  const [showMissingStub, setShowMissingStub] = useState(false)
  const manualEntry = useManualEntry()

  const today = todayIsoDate()
  const errors = validatePointEditForm(form, today)
  const canSubmit = isPointEditFormValid(form, today) && !manualEntry.isPending

  function handleMedicineChange(item: MedicineSuggestionItem | null): void {
    setMedicine(item)
    setForm((prev) => ({ ...prev, medicineId: item?.medicineId ?? null }))
  }

  function handleSubmit(): void {
    if (!isPointEditFormValid(form, today)) {
      return
    }
    manualEntry.mutate(buildManualEntryRow(form), {
      onSuccess: (): void => {
        setToast({ kind: 'success' })
        setMedicine(null)
        setForm(INITIAL_POINT_EDIT_STATE)
        setFormKey((key) => key + 1)
      },
      onError: (error): void => {
        setToast({ kind: 'error', messageKey: resolveManualEntryErrorKey(error.code) })
      },
    })
  }

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="point-edit-form"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <Toast state={toast} onClose={() => { setToast(null) }} />

      <MedicineAutocomplete key={formKey} value={medicine} onChange={handleMedicineChange} disabled={manualEntry.isPending} />

      <FormField
        label={t('pharmacy.inventory.point_edit.price_label')}
        error={form.priceTjs.length > 0 && errors.price ? t('pharmacy.inventory.point_edit.price_error') : undefined}
        errorTestId="point-edit-price-error"
      >
        <input
          type="number"
          step="0.01"
          value={form.priceTjs}
          disabled={manualEntry.isPending}
          data-testid="point-edit-price"
          onChange={(event) => { setForm((prev) => ({ ...prev, priceTjs: event.target.value })) }}
          className={INPUT_CLASS_NAME}
        />
      </FormField>

      <FormField
        label={t('pharmacy.inventory.point_edit.quantity_label')}
        error={form.quantity.length > 0 && errors.quantity ? t('pharmacy.inventory.point_edit.quantity_error') : undefined}
        errorTestId="point-edit-quantity-error"
      >
        <input
          type="number"
          step="1"
          value={form.quantity}
          disabled={manualEntry.isPending}
          data-testid="point-edit-quantity"
          onChange={(event) => { setForm((prev) => ({ ...prev, quantity: event.target.value })) }}
          className={INPUT_CLASS_NAME}
        />
      </FormField>

      <FormField
        label={t('pharmacy.inventory.point_edit.expiry_label')}
        error={form.expiryDate.length > 0 && errors.expiryDate ? t('pharmacy.inventory.point_edit.expiry_error') : undefined}
        errorTestId="point-edit-expiry-error"
      >
        <input
          type="date"
          value={form.expiryDate}
          disabled={manualEntry.isPending}
          data-testid="point-edit-expiry"
          onChange={(event) => { setForm((prev) => ({ ...prev, expiryDate: event.target.value })) }}
          className={INPUT_CLASS_NAME}
        />
      </FormField>

      <FormField label={t('pharmacy.inventory.point_edit.batch_label')}>
        <input
          type="text"
          value={form.batchNumber}
          disabled={manualEntry.isPending}
          placeholder={t('pharmacy.inventory.point_edit.batch_placeholder')}
          data-testid="point-edit-batch"
          onChange={(event) => { setForm((prev) => ({ ...prev, batchNumber: event.target.value })) }}
          className={INPUT_CLASS_NAME}
        />
      </FormField>

      {/* Заглушка: создание черновика позиции в каталоге — вне DTJ-167. */}
      <div>
        <button
          type="button"
          onClick={() => { setShowMissingStub(true) }}
          data-testid="missing-medicine-link"
          className="text-sm text-ink-muted underline"
        >
          {t('pharmacy.inventory.point_edit.missing_medicine_link')}
        </button>
        {showMissingStub ? (
          <p data-testid="missing-medicine-stub" className="mt-1 text-xs text-ink-muted">
            {t('pharmacy.inventory.point_edit.missing_medicine_stub_message')}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        data-testid="point-edit-submit"
        style={{ minHeight: MIN_TAP_ZONE_PX }}
        className="inline-flex items-center justify-center rounded-md bg-brand-primary px-4 font-semibold text-white disabled:opacity-50"
      >
        {manualEntry.isPending ? t('pharmacy.inventory.point_edit.submit_pending') : t('pharmacy.inventory.point_edit.submit')}
      </button>
    </form>
  )
}
