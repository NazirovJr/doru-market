/**
 * `select-parts.tsx` (DTJ-405) — презентационные подкомпоненты `Select`, вынесены в отдельный
 * файл ради лимита `max-lines` (`02-CLEAN-ARCHITECTURE-AND-CODE.md`, C1). Деталь реализации
 * `select.tsx` — не экспортируются из барабанного файла `components/index.ts`.
 */
import { type KeyboardEvent, type ReactElement } from 'react'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export const TRIGGER_HEIGHT_PX = 48

const ChevronIcon = (): ReactElement => (
  <svg aria-hidden="true" width={16} height={16} viewBox="0 0 16 16" fill="none">
    <path d="M4 6l4 4 4-4" stroke="var(--brand-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export interface SelectTriggerProps {
  readonly triggerId: string
  readonly listboxId: string
  readonly describedBy: string | undefined
  readonly isOpen: boolean
  readonly disabled: boolean
  readonly error: string | undefined
  readonly selectedLabel: string | null
  readonly placeholder: string | undefined
  readonly onToggle: () => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  readonly onFocus: () => void
  readonly isFocused: boolean
}

export const SelectTrigger = ({
  triggerId,
  listboxId,
  describedBy,
  isOpen,
  disabled,
  error,
  selectedLabel,
  placeholder,
  onToggle,
  onKeyDown,
  onFocus,
  isFocused,
}: SelectTriggerProps): ReactElement => (
  <button
    id={triggerId}
    type="button"
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    aria-controls={listboxId}
    aria-invalid={error === undefined ? undefined : true}
    aria-describedby={describedBy}
    disabled={disabled}
    onClick={onToggle}
    onKeyDown={onKeyDown}
    onFocus={onFocus}
    style={{
      boxSizing: 'border-box',
      width: '100%',
      height: `${String(TRIGGER_HEIGHT_PX)}px`,
      padding: '0 var(--space-3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--space-2)',
      fontSize: 'var(--font-size-base)',
      fontFamily: 'var(--brand-font-family)',
      color: selectedLabel === null ? 'var(--brand-text-muted)' : 'var(--brand-text)',
      background: disabled ? 'var(--brand-bg)' : 'var(--brand-surface)',
      border: `1px solid ${error === undefined ? 'var(--brand-border)' : 'var(--brand-danger)'}`,
      borderRadius: 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      outline: isFocused ? 'none' : undefined,
      boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
    }}
  >
    <span>{selectedLabel ?? placeholder ?? ''}</span>
    <ChevronIcon />
  </button>
)

export interface SelectListboxProps {
  readonly listboxId: string
  readonly triggerId: string
  readonly options: readonly SelectOption[]
  readonly value: string | null
  readonly highlightedIndex: number
  readonly onHighlight: (index: number) => void
  readonly onCommit: (value: string) => void
}

export const SelectListbox = ({
  listboxId,
  triggerId,
  options,
  value,
  highlightedIndex,
  onHighlight,
  onCommit,
}: SelectListboxProps): ReactElement => (
  <ul
    id={listboxId}
    role="listbox"
    aria-labelledby={triggerId}
    style={{
      boxSizing: 'border-box',
      position: 'absolute',
      zIndex: 10,
      top: `calc(${String(TRIGGER_HEIGHT_PX)}px + var(--space-1))`,
      left: 0,
      right: 0,
      margin: 0,
      padding: 'var(--space-1)',
      listStyle: 'none',
      background: 'var(--brand-surface)',
      border: '1px solid var(--brand-border)',
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-modal)',
      maxHeight: '256px',
      overflowY: 'auto',
    }}
  >
    {options.map((option, index) => {
      const isHighlighted = index === highlightedIndex
      const isSelected = option.value === value
      return (
        <li
          key={option.value}
          role="option"
          aria-selected={isSelected}
          onMouseEnter={() => { onHighlight(index) }}
          onMouseDown={(event) => {
            // `mousedown` (не `click`): предотвращает потерю фокуса триггером до commit.
            event.preventDefault()
            onHighlight(index)
            onCommit(option.value)
          }}
          style={{
            boxSizing: 'border-box',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-base)',
            fontFamily: 'var(--brand-font-family)',
            color: 'var(--brand-text)',
            background: isHighlighted ? 'var(--brand-bg)' : 'transparent',
            fontWeight: isSelected ? 'var(--font-weight-semibold)' : 'var(--font-weight-regular)',
            cursor: 'pointer',
          }}
        >
          {option.label}
        </li>
      )
    })}
  </ul>
)
