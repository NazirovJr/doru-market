import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useMedicineSuggest, MIN_MEDICINE_QUERY_LENGTH, type MedicineSuggestionItem } from '@/features/inventory-manual/api/use-medicine-suggest'
import { formatMedicineLabel } from '@/features/inventory-manual/model/manual-entry-form.model'

/**
 * `MedicineAutocomplete.tsx` (DTJ-167, EP-05, SRS-INV-015) — каталожный автокомплит выбора
 * медикамента для точечного редактирования остатка. Локальная реализация (DTJ-167 «Что сделать»
 * п.1: «переиспользовать, если уже есть в `packages/ui`/`entities`, создать здесь ТОЛЬКО если
 * ничего подходящего не существует к волне 4») — `packages/ui/src/index.ts` пуст на момент этого
 * тикета (заглушка EP-18), `entities`-слоя в `apps/pharmacy` не существует вовсе (DTJ-166 его не
 * заводил) — переиспользовать нечего, см. отчёт тикета, ДОПУЩЕНИЯ.
 *
 * Debounce 200мс (DTJ-167 «Что сделать» п.1, в диапазоне `SRS-DB-019` 150-300мс) — простой
 * `useEffect`+`setTimeout` внутри компонента (не отдельный хук `use-debounced-value.ts`, как в
 * `apps/web/src/features/search`): использован ровно один раз, вынесение в отдельный файл добавило
 * бы файл вне `files_owned` без выигрыша в переиспользовании.
 *
 * `value`/`onChange` — управляемый снаружи (`PointEditForm.tsx`) выбор: пока `value === null`,
 * поле ведёт себя как обычный автокомплит (дропдаун открыт при фокусе/вводе); как только
 * медикамент выбран, поле показывает его подпись и дропдаун/сеть больше не активны, пока
 * `PointEditForm` не сбросит `value` в `null` (сброс формы после успешной отправки — через
 * `key`, см. `PointEditForm.tsx`, ремаунт вместо ручной синхронизации внутреннего текста).
 */

const AUTOCOMPLETE_DEBOUNCE_MS = 200
/** Задержка перед закрытием дропдауна по `blur` — даёт `onMouseDown` опции сработать раньше `blur` инпута. */
const BLUR_CLOSE_DELAY_MS = 150

export interface MedicineAutocompleteProps {
  readonly value: MedicineSuggestionItem | null
  readonly onChange: (item: MedicineSuggestionItem | null) => void
  readonly disabled?: boolean
}

function useDebouncedText(rawQuery: string): string {
  const [debounced, setDebounced] = useState(rawQuery)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebounced(rawQuery.trim())
    }, AUTOCOMPLETE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timeoutId)
    }
  }, [rawQuery])
  return debounced
}

const SuggestList = ({
  items,
  isLoading,
  isError,
  onSelect,
}: {
  readonly items: readonly MedicineSuggestionItem[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly onSelect: (item: MedicineSuggestionItem) => void
}): ReactElement => {
  const { t } = useT('tj')
  return (
    <ul
      role="listbox"
      data-testid="medicine-autocomplete-list"
      className="absolute top-full z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-surface shadow-md"
    >
      {isLoading ? <li className="px-3 py-2 text-sm text-ink-muted">{t('pharmacy.inventory.autocomplete.loading')}</li> : null}
      {!isLoading && isError ? (
        <li className="px-3 py-2 text-sm text-brand-danger">{t('pharmacy.inventory.autocomplete.error')}</li>
      ) : null}
      {!isLoading && !isError && items.length === 0 ? (
        <li className="px-3 py-2 text-sm text-ink-muted">{t('pharmacy.inventory.autocomplete.empty')}</li>
      ) : null}
      {items.map((item) => (
        <li key={item.medicineId} role="option" aria-selected={false}>
          <button
            type="button"
            data-testid="medicine-autocomplete-option"
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(item)
            }}
            className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-line"
          >
            <span className="font-medium text-ink">{item.tradeName}</span>
            <span className="text-xs text-ink-muted">
              {item.dosageForm}, {item.dosageStrength}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export const MedicineAutocomplete = ({ value, onChange, disabled = false }: MedicineAutocompleteProps): ReactElement => {
  const { t } = useT('tj')
  const [rawQuery, setRawQuery] = useState(value === null ? '' : formatMedicineLabel(value.tradeName, value.dosageForm, value.dosageStrength))
  const [isOpen, setIsOpen] = useState(false)
  const debouncedQuery = useDebouncedText(rawQuery)

  const suggestQuery = useMedicineSuggest(debouncedQuery, isOpen && value === null)
  const items = suggestQuery.data ?? []
  const showDropdown = isOpen && value === null && debouncedQuery.length >= MIN_MEDICINE_QUERY_LENGTH

  function handleSelect(item: MedicineSuggestionItem): void {
    setRawQuery(formatMedicineLabel(item.tradeName, item.dosageForm, item.dosageStrength))
    setIsOpen(false)
    onChange(item)
  }

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor="medicine-autocomplete-input" className="text-sm text-ink">
        {t('pharmacy.inventory.point_edit.medicine_label')}
      </label>
      <input
        id="medicine-autocomplete-input"
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        value={rawQuery}
        disabled={disabled}
        placeholder={t('pharmacy.inventory.autocomplete.placeholder')}
        data-testid="medicine-autocomplete-input"
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
        onChange={(event) => {
          setRawQuery(event.target.value)
          setIsOpen(true)
          if (value !== null) {
            onChange(null)
          }
        }}
        onFocus={() => {
          setIsOpen(true)
        }}
        onBlur={() => {
          setTimeout(() => {
            setIsOpen(false)
          }, BLUR_CLOSE_DELAY_MS)
        }}
      />
      {showDropdown ? (
        <SuggestList items={items} isLoading={suggestQuery.isLoading} isError={suggestQuery.isError} onSelect={handleSelect} />
      ) : null}
    </div>
  )
}
