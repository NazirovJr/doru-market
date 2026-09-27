import { useEffect, useState, type ReactElement } from 'react'
import { useT } from '@dorutj/i18n'
import { Button, Input } from '@dorutj/ui'
import { useLocale } from '@/shared/config/locale-provider'
import { useMedicineSuggest, type MedicineSuggestionItem } from '@/shared/api/use-medicine-search'
import { formatMedicineLabel } from '@/features/inventory-bulk/api/use-bulk-grid'

const MEDICINE_SEARCH_DEBOUNCE_MS = 200

function useDebouncedText(rawQuery: string): string {
  const [debounced, setDebounced] = useState(rawQuery)
  useEffect(() => {
    const timeoutId = setTimeout(() => { setDebounced(rawQuery.trim()) }, MEDICINE_SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(timeoutId) }
  }, [rawQuery])
  return debounced
}

export const MedicinePicker = ({
  onSelect,
  onCancel,
}: {
  readonly onSelect: (item: MedicineSuggestionItem) => void
  readonly onCancel: () => void
}): ReactElement => {
  const { locale } = useLocale()
  const { t } = useT(locale)
  const [rawQuery, setRawQuery] = useState('')
  const debouncedQuery = useDebouncedText(rawQuery)
  const suggestQuery = useMedicineSuggest(debouncedQuery, true)
  const items = suggestQuery.data ?? []

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-testid="bulk-grid-medicine-picker">
      <Input
        type="text"
        autoFocus
        label={t('pharmacy.inventory.point_edit.medicine_label')}
        value={rawQuery}
        placeholder={t('pharmacy.inventory.autocomplete.placeholder')}
        data-testid="bulk-grid-medicine-picker-input"
        onChange={(event) => { setRawQuery(event.target.value) }}
      />
      <ul data-testid="bulk-grid-medicine-picker-list" className="flex max-h-48 flex-col overflow-auto">
        {suggestQuery.isLoading ? <li className="text-sm text-ink-muted">{t('pharmacy.inventory.autocomplete.loading')}</li> : null}
        {!suggestQuery.isLoading && items.length === 0 ? (
          <li className="text-sm text-ink-muted">{t('pharmacy.inventory.autocomplete.empty')}</li>
        ) : null}
        {items.map((item) => (
          <li key={item.medicineId}>
            <button
              type="button"
              data-testid="bulk-grid-medicine-picker-option"
              onClick={() => { onSelect(item) }}
              className="w-full px-2 py-1 text-left text-sm hover:bg-line"
            >
              {formatMedicineLabel(item)}
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="ghost" onClick={onCancel} data-testid="bulk-grid-medicine-picker-cancel">
        {t('pharmacy.inventory.bulk_edit.grid_cancel_new_row')}
      </Button>
    </div>
  )
}
