/**
 * `suggest-dropdown.tsx` (DTJ-192, `SRS-CAT-027`/`030`).
 *
 * Чисто презентационный список подсказок под `SearchBar` — состояние (какой пункт активен,
 * открыт ли дропдаун вообще) держит `search-bar.tsx`, этот компонент только рендерит.
 *
 * Роль `listbox`/`option` — вторая половина ARIA 1.2 combobox-паттерна (`role="combobox"` живёт
 * на самом `<input>` в `search-bar.tsx`); `aria-selected` на активной опции синхронизирован с
 * `aria-activedescendant` инпута. `onMouseDown` (не `onClick`) с `preventDefault()` — стандартный
 * приём: `onClick` сработал бы ПОСЛЕ `blur` инпута, а `blur` уже успел бы закрыть дропдаун.
 */
import type { ReactElement } from 'react'
import type { TranslateFunction } from '@dorutj/i18n'
import type { SuggestSuggestion } from '../api/search.api'

export type SuggestDropdownStatus = 'loading' | 'error' | 'empty' | 'ready'

export interface SuggestDropdownProps {
  readonly listboxId: string
  readonly getOptionId: (index: number) => string
  readonly items: readonly SuggestSuggestion[]
  readonly activeIndex: number
  readonly status: SuggestDropdownStatus
  readonly onSelect: (item: SuggestSuggestion) => void
  readonly t: TranslateFunction
}

const StatusMessage = ({
  status,
  t,
}: {
  readonly status: SuggestDropdownStatus
  readonly t: TranslateFunction
}): ReactElement => {
  if (status === 'loading') {
    return (
      <p role="status" data-testid="suggest-dropdown-loading" className="p-3 text-sm text-ink-muted">
        {t('search.suggest.loading')}
      </p>
    )
  }
  return (
    <p role="alert" data-testid="suggest-dropdown-error" className="p-3 text-sm text-ink-muted">
      {t('search.suggest.error')}
    </p>
  )
}

export const SuggestDropdown = ({
  listboxId,
  getOptionId,
  items,
  activeIndex,
  status,
  onSelect,
  t,
}: SuggestDropdownProps): ReactElement => {
  return (
    <div
      className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-line bg-surface shadow-md"
      data-testid="suggest-dropdown"
    >
      {status === 'loading' || status === 'error' ? <StatusMessage status={status} t={t} /> : null}
      {status === 'empty' ? (
        <p role="status" data-testid="suggest-dropdown-empty" className="p-3 text-sm text-ink-muted">
          {t('search.suggest.empty')}
        </p>
      ) : null}
      {status === 'ready' ? (
        <ul id={listboxId} role="listbox" data-testid="suggest-dropdown-list" className="max-h-72 overflow-y-auto py-1">
          {items.map((item, index) => (
            <li
              key={`${item.matchedVia}-${item.tradeName}`}
              id={getOptionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              data-testid="suggest-dropdown-option"
              className={`cursor-pointer px-3 py-2 text-sm ${index === activeIndex ? 'bg-brand-primary/10' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(item)
              }}
            >
              {item.tradeName}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
