import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { useMedicineSuggest, MIN_MEDICINE_QUERY_LENGTH, type MedicineSuggestionItem } from '@/features/inventory-manual/api/use-medicine-suggest'
import { formatMedicineLabel } from '@/features/inventory-manual/model/manual-entry-form.model'

/** Выбор управляется снаружи: при `value !== null` дропдаун и запросы выключены до сброса через `key`. */

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
