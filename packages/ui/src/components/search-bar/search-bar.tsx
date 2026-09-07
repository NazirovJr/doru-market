import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import { IconButton } from '../icon-button/icon-button.js'
import { Input } from '../input/input.js'
import { cx } from '../shared/cx.js'
import './search-bar.css'

/** Дефолт debounce (`SRS-UX-009` 150-300мс) — конфигурируемый пропом `debounceMs`, не единственное
 * хардкод-значение без возможности переопределения. */
const DEFAULT_DEBOUNCE_MS = 200

type SearchBarVoiceProps =
  | {
      /** ОПЦИОНАЛЬНЫЙ голосовой ввод (`[R1·флаг]`) — иконка микрофона рендерится, только если
       * передан. `voiceInputAriaLabel` обязателен ВМЕСТЕ с `onVoiceInput` (доступное имя
       * icon-only кнопки, `SRS-UX-034`). */
      readonly onVoiceInput: () => void
      readonly voiceInputAriaLabel: string
    }
  | { readonly onVoiceInput?: undefined; readonly voiceInputAriaLabel?: undefined }

export type SearchBarProps = {
  /** Видимый label поля (`SRS-UX-034` «Форма») — передаётся потребителем через `useT()`. */
  readonly label: string
  readonly defaultValue?: string
  readonly placeholder?: string
  /** Вызывается с итоговой строкой запроса после `debounceMs` тишины ввода. */
  readonly onSearch: (query: string) => void
  readonly debounceMs?: number
  readonly className?: string
} & SearchBarVoiceProps

/**
 * Поле поиска (`SRS-UX-021`, точка входа CUJ-1) поверх `Input` (DTJ-404). Debounce
 * `debounceMs` (дефолт 200мс, `SRS-UX-009`) схлопывает быстрый ввод в один вызов `onSearch`.
 * `spellcheck="false"`, `autoCorrect`/`autoCapitalize="off"` — не мешает серверной нормализации
 * таджикской кириллицы (`SRS-UX-030`).
 */
export const SearchBar = ({
  label,
  defaultValue = '',
  placeholder,
  onSearch,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onVoiceInput,
  voiceInputAriaLabel,
  className,
}: SearchBarProps): ReactElement => {
  const [value, setValue] = useState(defaultValue)
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => (): void => {
      clearTimeout(debounceTimeoutRef.current)
    },
    [],
  )

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextValue = event.target.value
    setValue(nextValue)
    clearTimeout(debounceTimeoutRef.current)
    debounceTimeoutRef.current = setTimeout(() => {
      onSearch(nextValue)
    }, debounceMs)
  }

  return (
    <div className={cx('ui-search-bar', className)}>
      <div className="ui-search-bar__field">
        <Input
          label={label}
          type="search"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
      {onVoiceInput !== undefined ? (
        <IconButton
          aria-label={voiceInputAriaLabel}
          icon={<MicIcon />}
          size="sm"
          onClick={onVoiceInput}
          className="ui-search-bar__voice-button"
        />
      ) : null}
    </div>
  )
}

const MIC_ICON_SIZE_PX = 18

const MicIcon = (): ReactElement => (
  <svg width={MIC_ICON_SIZE_PX} height={MIC_ICON_SIZE_PX} viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3.5 8.5a5.5 5.5 0 0 0 11 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M9 14v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)
