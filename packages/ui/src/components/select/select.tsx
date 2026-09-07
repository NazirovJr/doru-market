import { useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, ReactElement, RefObject } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { FieldError } from '../input/field-error.js'
import { getFieldDescribedBy } from '../input/field-shared.js'
import '../input/input.css'
import './select.css'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps {
  readonly label: string
  readonly options: readonly SelectOption[]
  readonly value: string | null
  readonly onChange: (value: string) => void
  /** Текст, когда `value === null` — переведённый потребителем (`AGENTS.md` §9). */
  readonly placeholder: string
  readonly error?: string
  readonly id?: string
}

function getSelectedIndex(options: readonly SelectOption[], value: string | null): number {
  return options.findIndex((option) => option.value === value)
}

function getOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${String(index)}`
}

interface SelectNavigationInput {
  readonly isOpen: boolean
  readonly options: readonly SelectOption[]
  readonly highlightedIndex: number
  readonly openAt: (index: number) => void
  readonly setHighlightedIndex: (index: number) => void
  readonly commitHighlighted: () => void
  readonly close: () => void
}

function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>, input: SelectNavigationInput): void {
  const { isOpen, options, highlightedIndex, openAt, setHighlightedIndex, commitHighlighted, close } = input
  const lastIndex = options.length - 1

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!isOpen) {
      openAt(highlightedIndex)
      return
    }
    setHighlightedIndex(Math.min(highlightedIndex + 1, lastIndex))
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!isOpen) {
      openAt(highlightedIndex)
      return
    }
    setHighlightedIndex(Math.max(highlightedIndex - 1, 0))
    return
  }
  if (event.key === 'Enter' && isOpen) {
    event.preventDefault()
    commitHighlighted()
    return
  }
  if (event.key === 'Escape' && isOpen) {
    event.preventDefault()
    close()
  }
}

interface UseSelectStateResult {
  readonly isOpen: boolean
  readonly highlightedIndex: number
  readonly selectedOption: SelectOption | null
  readonly wrapperRef: RefObject<HTMLDivElement | null>
  readonly openAt: (index: number) => void
  readonly close: () => void
  readonly commit: (index: number) => void
  readonly setHighlightedIndex: (index: number) => void
  readonly handleBlur: (event: FocusEvent<HTMLDivElement>) => void
}

function useSelectState(options: readonly SelectOption[], value: string | null, onChange: (value: string) => void): UseSelectStateResult {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(getSelectedIndex(options, value), 0))
  const wrapperRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => option.value === value) ?? null

  const openAt = (index: number): void => {
    setHighlightedIndex(index)
    setIsOpen(true)
  }

  const close = (): void => {
    setIsOpen(false)
  }

  const commit = (index: number): void => {
    const option = options[index]
    if (option === undefined) {
      return
    }
    onChange(option.value)
    close()
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const nextFocusTarget = event.relatedTarget as Node | null
    if (!wrapperRef.current?.contains(nextFocusTarget)) {
      close()
    }
  }

  return { isOpen, highlightedIndex, selectedOption, wrapperRef, openAt, close, commit, setHighlightedIndex, handleBlur }
}

interface SelectTriggerProps {
  readonly fieldId: string
  readonly listboxId: string
  readonly state: UseSelectStateResult
  readonly options: readonly SelectOption[]
  readonly value: string | null
  readonly placeholder: string
  readonly error: string | undefined
  readonly errorId: string | undefined
  readonly prefersReducedMotion: boolean
}

function getTriggerClassName(error: string | undefined, prefersReducedMotion: boolean): string {
  return cx(
    'ui-field__control',
    'ui-select__trigger',
    error !== undefined && 'ui-field__control--error',
    !prefersReducedMotion && 'ui-field__control--motion',
  )
}

const SelectTrigger = ({
  fieldId,
  listboxId,
  state,
  options,
  value,
  placeholder,
  error,
  errorId,
  prefersReducedMotion,
}: SelectTriggerProps): ReactElement => {
  const { isOpen, highlightedIndex, selectedOption, openAt, close, commit, setHighlightedIndex } = state

  return (
    <button
      type="button"
      id={fieldId}
      className={getTriggerClassName(error, prefersReducedMotion)}
      aria-haspopup="listbox"
      aria-expanded={isOpen}
      aria-controls={listboxId}
      aria-activedescendant={isOpen ? getOptionId(listboxId, highlightedIndex) : undefined}
      aria-invalid={error !== undefined || undefined}
      aria-describedby={getFieldDescribedBy(errorId, undefined)}
      onClick={() => {
        if (isOpen) {
          close()
        } else {
          openAt(Math.max(getSelectedIndex(options, value), 0))
        }
      }}
      onKeyDown={(event) => {
        handleTriggerKeyDown(event, {
          isOpen,
          options,
          highlightedIndex,
          openAt,
          setHighlightedIndex,
          commitHighlighted: () => {
            commit(highlightedIndex)
          },
          close,
        })
      }}
    >
      <span className={cx('ui-select__value', selectedOption === null && 'ui-select__value--placeholder')}>
        {selectedOption?.label ?? placeholder}
      </span>
      <ChevronIcon isOpen={isOpen} isMotionEnabled={!prefersReducedMotion} />
    </button>
  )
}

interface SelectListProps {
  readonly listboxId: string
  readonly fieldId: string
  readonly options: readonly SelectOption[]
  readonly value: string | null
  readonly state: UseSelectStateResult
}

const SelectList = ({ listboxId, fieldId, options, value, state }: SelectListProps): ReactElement => (
  <ul id={listboxId} role="listbox" aria-labelledby={`${fieldId}-label`} className="ui-select__list" hidden={!state.isOpen}>
    {options.map((option, index) => (
      <li
        key={option.value}
        id={getOptionId(listboxId, index)}
        role="option"
        aria-selected={option.value === value}
        className={cx(
          'ui-select__option',
          index === state.highlightedIndex && 'ui-select__option--highlighted',
          option.value === value && 'ui-select__option--selected',
        )}
        onMouseEnter={() => {
          state.setHighlightedIndex(index)
        }}
        onClick={() => {
          state.commit(index)
        }}
      >
        {option.label}
      </li>
    ))}
  </ul>
)

/**
 * `Select` (`SRS-UX-021`) — `closed`/`open`, `role="listbox"`, полная клавиатурная навигация
 * (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`). Выбор мышью и клавиатурой идут через один и тот же
 * `commit`, гарантированно дают идентичный результат. Логика вынесена в `useSelectState`, разметка
 * триггера/списка — в `SelectTrigger`/`SelectList`, чтобы уложиться в порог сложности функции
 * (`AGENTS.md` C1-C5).
 */
export const Select = ({ label, options, value, onChange, placeholder, error, id }: SelectProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const listboxId = `${fieldId}-listbox`
  const errorId = error !== undefined ? `${fieldId}-error` : undefined
  const state = useSelectState(options, value, onChange)

  return (
    <div className="ui-field" ref={state.wrapperRef} onBlur={state.handleBlur}>
      <label className="ui-field__label" id={`${fieldId}-label`} htmlFor={fieldId}>
        {label}
      </label>
      <div className="ui-select">
        <SelectTrigger
          fieldId={fieldId}
          listboxId={listboxId}
          state={state}
          options={options}
          value={value}
          placeholder={placeholder}
          error={error}
          errorId={errorId}
          prefersReducedMotion={prefersReducedMotion}
        />
        <SelectList listboxId={listboxId} fieldId={fieldId} options={options} value={value} state={state} />
      </div>
      {error !== undefined ? <FieldError id={errorId ?? `${fieldId}-error`} message={error} /> : null}
    </div>
  )
}

interface ChevronIconProps {
  readonly isOpen: boolean
  readonly isMotionEnabled: boolean
}

const ChevronIcon = ({ isOpen, isMotionEnabled }: ChevronIconProps): ReactElement => (
  <svg
    className={cx(
      'ui-select__chevron',
      isOpen && 'ui-select__chevron--open',
      isMotionEnabled && 'ui-select__chevron--motion',
    )}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
