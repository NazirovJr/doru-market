import { useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, Input, useToast } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useAuthStore } from '@/shared/api/auth-store'
import { canSaveInventory } from '@/shared/auth/inventory-permissions'
import { useManualEntry } from '@/features/inventory-manual/api/use-manual-entry'
import type { MedicineSuggestionItem } from '@/shared/api/use-medicine-search'
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

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 'YYYY-MM-DD'.length)
}

/** `exactOptionalPropertyTypes` запрещает `error: undefined` — пропускаем проп целиком, если ошибки нет. */
function errorProp(hasError: boolean, message: string): { readonly error?: string } {
  return hasError ? { error: message } : {}
}

export const PointEditForm = (): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const toast = useToast()
  // Смена key ремаунтит автокомплит — проще, чем синхронизировать его внутренний текст.
  const [formKey, setFormKey] = useState(0)
  const [medicine, setMedicine] = useState<MedicineSuggestionItem | null>(null)
  const [form, setForm] = useState<PointEditFormState>(INITIAL_POINT_EDIT_STATE)
  const [showMissingStub, setShowMissingStub] = useState(false)
  const manualEntry = useManualEntry()
  const canSave = canSaveInventory(useAuthStore((state) => state.user?.role))

  const today = todayIsoDate()
  const errors = validatePointEditForm(form, today)
  const canSubmit = canSave && isPointEditFormValid(form, today) && !manualEntry.isPending
  const fieldsDisabled = !canSave || manualEntry.isPending

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
        toast.success(t('pharmacy.inventory.point_edit.toast_success'))
        setMedicine(null)
        setForm(INITIAL_POINT_EDIT_STATE)
        setFormKey((key) => key + 1)
      },
      onError: (error): void => {
        toast.error(t(resolveManualEntryErrorKey(error.code)), { persistent: true })
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
      <MedicineAutocomplete key={formKey} value={medicine} onChange={handleMedicineChange} disabled={fieldsDisabled} />

      <Input
        id="point-edit-price"
        type="number"
        step="0.01"
        label={t('pharmacy.inventory.point_edit.price_label')}
        {...errorProp(form.priceTjs.length > 0 && errors.price, t('pharmacy.inventory.point_edit.price_error'))}
        value={form.priceTjs}
        disabled={fieldsDisabled}
        data-testid="point-edit-price"
        onChange={(event) => { setForm((prev) => ({ ...prev, priceTjs: event.target.value })) }}
      />

      <Input
        id="point-edit-quantity"
        type="number"
        step="1"
        label={t('pharmacy.inventory.point_edit.quantity_label')}
        {...errorProp(form.quantity.length > 0 && errors.quantity, t('pharmacy.inventory.point_edit.quantity_error'))}
        value={form.quantity}
        disabled={fieldsDisabled}
        data-testid="point-edit-quantity"
        onChange={(event) => { setForm((prev) => ({ ...prev, quantity: event.target.value })) }}
      />

      <Input
        id="point-edit-expiry"
        type="date"
        label={t('pharmacy.inventory.point_edit.expiry_label')}
        {...errorProp(form.expiryDate.length > 0 && errors.expiryDate, t('pharmacy.inventory.point_edit.expiry_error'))}
        value={form.expiryDate}
        disabled={fieldsDisabled}
        data-testid="point-edit-expiry"
        onChange={(event) => { setForm((prev) => ({ ...prev, expiryDate: event.target.value })) }}
      />

      <Input
        id="point-edit-batch"
        type="text"
        label={t('pharmacy.inventory.point_edit.batch_label')}
        value={form.batchNumber}
        disabled={fieldsDisabled}
        placeholder={t('pharmacy.inventory.point_edit.batch_placeholder')}
        data-testid="point-edit-batch"
        onChange={(event) => { setForm((prev) => ({ ...prev, batchNumber: event.target.value })) }}
      />

      {/* Заглушка: создание черновика позиции в каталоге — вне DTJ-167. */}
      {canSave ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => { setShowMissingStub(true) }}
            data-testid="missing-medicine-link"
          >
            {t('pharmacy.inventory.point_edit.missing_medicine_link')}
          </Button>
          {showMissingStub ? (
            <p data-testid="missing-medicine-stub" className="mt-1 text-xs text-ink-muted">
              {t('pharmacy.inventory.point_edit.missing_medicine_stub_message')}
            </p>
          ) : null}
        </div>
      ) : null}

      {canSave ? (
        <Button
          type="submit"
          disabled={!canSubmit}
          loading={manualEntry.isPending}
          size="lg"
          data-testid="point-edit-submit"
          style={{ minHeight: MIN_TAP_ZONE_PX }}
        >
          {t('pharmacy.inventory.point_edit.submit')}
        </Button>
      ) : (
        <p role="status" data-testid="point-edit-readonly-hint" className="text-sm text-ink-muted">
          {t('pharmacy.inventory.point_edit.error_insufficient_role')}
        </p>
      )}
    </form>
  )
}
