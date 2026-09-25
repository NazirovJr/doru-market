/**
 * `SearchBar` (DTJ-408, `SRS-UX-009`/`SRS-UX-030`) — точка входа CUJ-1 (единственный подтверждённый
 * защитимый путь продукта). Debounce 150–300мс (`SRS-UX-009`): конкретное значение —
 * КОНФИГУРИРУЕМЫЙ проп `debounceMs` с дефолтом 200мс, не единственное захардкоженное значение.
 *
 * `spellCheck={false}` + `autoCapitalize="off"`/`autoCorrect="off"` (`SRS-UX-030`) — не мешать
 * серверной нормализации таджикской кириллицы браузерными эвристиками автозамены.
 *
 * Голосовая иконка — ОПЦИОНАЛЬНЫЙ проп `onVoiceInput`: рендерится только если передан
 * (голосовой ввод `[R1·флаг]`). Когда передан, `voiceButtonLabel` обязателен на уровне типов
 * (та же техника, что `IconButton.aria-label` — `RequiredAriaLabel`), т.к. `IconButton` требует
 * `aria-label`.
 */
import {
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { buildTransition } from '../internal/motion'
import { IconButton } from '../icon-button/icon-button'

export const DEFAULT_SEARCH_DEBOUNCE_MS = 200

const SEARCH_BAR_HEIGHT_PX = 48

type SearchBarVoiceProps =
  | { readonly onVoiceInput?: undefined; readonly voiceButtonLabel?: undefined }
  | { readonly onVoiceInput: () => void; readonly voiceButtonLabel: string }

export type SearchBarProps = SearchBarVoiceProps & {
  readonly onSearch: (query: string) => void
  /** `SRS-UX-009`: 150–300мс, дефолт 200мс. */
  readonly debounceMs?: number
  readonly placeholder?: string
  readonly defaultValue?: string
  /** Доступное имя текстового поля (SRS-UX-034) — визуальной `<label>` у поисковой строки нет. */
  readonly 'aria-label': string
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  boxSizing: 'border-box',
  height: `${String(SEARCH_BAR_HEIGHT_PX)}px`,
  padding: '0 var(--space-3)',
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--brand-border)',
  background: 'var(--brand-surface)',
}

const BASE_INPUT_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  fontSize: 'var(--font-size-base)',
  fontFamily: 'var(--brand-font-family)',
  color: 'var(--brand-text)',
}

const SearchIcon = (): ReactElement => (
  <svg aria-hidden="true" width={20} height={20} viewBox="0 0 20 20" fill="none">
    <circle cx="9" cy="9" r="6" stroke="var(--brand-text-muted)" strokeWidth="1.6" />
    <path d="m17 17-3.5-3.5" stroke="var(--brand-text-muted)" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const MicIcon = (): ReactElement => (
  <svg aria-hidden="true" width={18} height={18} viewBox="0 0 18 18" fill="none">
    <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="var(--brand-text-muted)" strokeWidth="1.5" />
    <path d="M4 9.5a5 5 0 0 0 10 0M9 14.5v2" stroke="var(--brand-text-muted)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const SearchBar = ({
  onSearch,
  debounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  placeholder,
  defaultValue = '',
  onVoiceInput,
  voiceButtonLabel,
  'aria-label': ariaLabel,
}: SearchBarProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const [value, setValue] = useState(defaultValue)
  const [isFocused, setIsFocused] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) {
        clearTimeout(timeoutRef.current)
      }
    },
    [],
  )

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextValue = event.target.value
    setValue(nextValue)
    if (timeoutRef.current !== undefined) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      onSearch(nextValue)
    }, debounceMs)
  }

  return (
    <div style={CONTAINER_STYLE}>
      <SearchIcon />
      <input
        type="search"
        aria-label={ariaLabel}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onFocus={() => { setIsFocused(true) }}
        onBlur={() => { setIsFocused(false) }}
        style={{
          ...BASE_INPUT_STYLE,
          // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
          outline: isFocused ? 'none' : undefined,
          boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
          transition: buildTransition(['box-shadow'], prefersReducedMotion),
        }}
      />
      {onVoiceInput !== undefined && (
        <IconButton aria-label={voiceButtonLabel} icon={<MicIcon />} onClick={onVoiceInput} />
      )}
    </div>
  )
}
