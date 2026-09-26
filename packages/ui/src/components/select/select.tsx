/**
 * `Select` (DTJ-405, `SRS-UX-002`/`SRS-UX-019`/`SRS-UX-034`) — кастомный выпадающий список с
 * полной клавиатурной навигацией (`ArrowUp`/`ArrowDown` двигают подсветку БЕЗ подтверждения
 * значения, `Enter` подтверждает подсвеченную опцию и закрывает, `Escape` закрывает БЕЗ изменения
 * значения). Семантика — `combobox`/`listbox` (WAI-ARIA), `aria-expanded` на триггере,
 * `role="listbox"` на списке, `aria-selected` на текущей опции.
 *
 * Контролируемый компонент: `value`/`onChange` — источник истины у потребителя (тот же
 * контракт, что у `Input`). Разметка триггера/списка — в `select-parts.tsx` (лимит `max-lines`,
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` C1), здесь — только состояние и обработчики.
 */
import { type FocusEvent, type KeyboardEvent, type ReactElement, useId, useRef, useState } from 'react'
import { FieldChrome } from '../internal/field-chrome'
import { SelectListbox, type SelectOption, SelectTrigger } from './select-parts'

export type { SelectOption } from './select-parts'

export interface SelectProps {
  readonly id?: string
  readonly label: string
  readonly options: readonly SelectOption[]
  readonly value: string | null
  readonly onChange: (value: string) => void
  readonly error?: string
  readonly placeholder?: string
  readonly disabled?: boolean
}

const indexOfValue = (options: readonly SelectOption[], value: string | null): number =>
  options.findIndex((option) => option.value === value)

const clampIndex = (index: number, length: number): number => Math.max(0, Math.min(index, length - 1))

interface OpenKeyboardInput {
  readonly key: string
  readonly options: readonly SelectOption[]
  readonly highlightedIndex: number
  readonly onHighlight: (index: number) => void
  readonly onCommit: () => void
  readonly onClose: () => void
}

/** Обрабатывает клавиатуру ОТКРЫТОГО списка — вынесено, чтобы не раздувать сложность триггера. */
const handleOpenKeyboard = ({ key, options, highlightedIndex, onHighlight, onCommit, onClose }: OpenKeyboardInput): boolean => {
  if (key === 'ArrowDown') {
    onHighlight(clampIndex(highlightedIndex + 1, options.length))
  } else if (key === 'ArrowUp') {
    onHighlight(clampIndex(highlightedIndex - 1, options.length))
  } else if (key === 'Enter') {
    onCommit()
  } else if (key === 'Escape') {
    onClose()
  } else {
    return false
  }
  return true
}

const OPEN_TRIGGER_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' '])

export const Select = ({
  id,
  label,
  options,
  value,
  onChange,
  error,
  placeholder,
  disabled = false,
}: SelectProps): ReactElement => {
  const generatedId = useId()
  const triggerId = id ?? generatedId
  const listboxId = `${triggerId}-listbox`
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(() =>
    Math.max(0, indexOfValue(options, value)),
  )
  const [isFocused, setIsFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((option) => option.value === value) ?? null

  const openAt = (index: number): void => {
    setHighlightedIndex(clampIndex(index, options.length))
    setIsOpen(true)
  }

  const close = (): void => {
    setIsOpen(false)
  }

  const commit = (nextValue: string): void => {
    onChange(nextValue)
    close()
  }

  const commitHighlighted = (): void => {
    const option = options[highlightedIndex]
    if (option !== undefined) {
      commit(option.value)
    } else {
      close()
    }
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled || options.length === 0) {
      return
    }
    if (!isOpen) {
      if (OPEN_TRIGGER_KEYS.has(event.key)) {
        event.preventDefault()
        openAt(Math.max(0, indexOfValue(options, value)))
      }
      return
    }
    const handled = handleOpenKeyboard({
      key: event.key,
      options,
      highlightedIndex,
      onHighlight: setHighlightedIndex,
      onCommit: commitHighlighted,
      onClose: close,
    })
    if (handled) {
      event.preventDefault()
    }
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    setIsFocused(false)
    const nextFocusTarget = event.relatedTarget
    if (nextFocusTarget instanceof Node && containerRef.current?.contains(nextFocusTarget) === true) {
      return
    }
    close()
  }

  return (
    <FieldChrome id={triggerId} label={label} error={error}>
      {(describedBy) => (
        <div ref={containerRef} style={{ position: 'relative' }} onBlur={handleBlur}>
          <SelectTrigger
            triggerId={triggerId}
            listboxId={listboxId}
            describedBy={describedBy}
            isOpen={isOpen}
            disabled={disabled}
            error={error}
            selectedLabel={selectedOption?.label ?? null}
            placeholder={placeholder}
            isFocused={isFocused}
            onFocus={() => { setIsFocused(true) }}
            onKeyDown={handleTriggerKeyDown}
            onToggle={() => {
              if (isOpen) {
                close()
              } else {
                openAt(Math.max(0, indexOfValue(options, value)))
              }
            }}
          />
          {isOpen ? (
            <SelectListbox
              listboxId={listboxId}
              triggerId={triggerId}
              options={options}
              value={value}
              highlightedIndex={highlightedIndex}
              onHighlight={setHighlightedIndex}
              onCommit={commit}
            />
          ) : null}
        </div>
      )}
    </FieldChrome>
  )
}
