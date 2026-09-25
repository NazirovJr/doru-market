/**
 * `PhoneInput` (DTJ-405, `SRS-UX-002`/`SRS-UX-019`/`SRS-UX-021`/`SRS-UX-034`, `SRS-DOM-069`) —
 * единственный вход в продукт (`/login`, все 5 ролей RBAC). Фиксированный НЕИЗМЕНЯЕМЫЙ
 * визуальный префикс `+992` вынесен из `<input>` в отдельный `<span>` (пользователь не может его
 * стереть/выделить вместе с номером) — `<input>` принимает только 9 национальных цифр, маска
 * `XX XXX XX XX` строится через `formatPhone` из `@dorutj/i18n` (DTJ-402): переиспользуем
 * существующий форматтер вместо дублирования группировки цифр (AGENTS.md §12).
 *
 * `onChange` отдаёт наружу normalized E.164-подобную строку `+992XXXXXXXXX` (даже при неполном
 * вводе — соответствует поведению `phone-step.tsx`, `toE164`), визуально отформатированное
 * значение — внутреннее состояние компонента (неконтролируемый ввод, опциональный `value` —
 * только начальное значение, критерий приёмки 4 не передаёт `value` вовсе).
 *
 * `blur` с неполным номером (< 9 цифр) показывает встроенный `error`-слот `FieldChrome`
 * (текст — `ui.phone_input.incomplete_error`, все три словаря) и вызывает `onValidate(false)`;
 * явно переданный проп `error` имеет приоритет над встроенной валидацией (тот же контракт,
 * что у `Input`/`Textarea`).
 */
import { type ChangeEvent, type ReactElement, useId, useState } from 'react'
import { formatPhone, type Locale, useT } from '@dorutj/i18n'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { FieldChrome } from '../internal/field-chrome'

const COUNTRY_CODE = '992'
const COUNTRY_PREFIX = '+992'
const PHONE_DIGITS_REQUIRED = 9
const INPUT_HEIGHT_PX = MIN_HIT_AREA_PX
const DEFAULT_LOCALE: Locale = 'tj'

const digitsOnly = (raw: string): string => raw.replace(/\D/g, '')

/** Национальные цифры из E.164-подобной строки (обрезает код страны `992`, если он есть). */
const extractNationalDigits = (value: string): string => {
  const all = digitsOnly(value)
  const stripped = all.startsWith(COUNTRY_CODE) ? all.slice(COUNTRY_CODE.length) : all
  return stripped.slice(0, PHONE_DIGITS_REQUIRED)
}

/** `formatPhone` возвращает `+992 XX XXX XX XX` целиком — здесь нужна ТОЛЬКО национальная часть. */
const formatNationalDisplay = (nationalDigits: string): string => {
  if (nationalDigits.length === 0) {
    return ''
  }
  return formatPhone(`${COUNTRY_PREFIX}${nationalDigits}`).slice(COUNTRY_PREFIX.length).trim()
}

const toE164 = (nationalDigits: string): string => `${COUNTRY_PREFIX}${nationalDigits}`

export interface PhoneInputProps {
  readonly id?: string
  readonly label: string
  /** Начальное значение (E.164-подобная строка). Далее компонент — источник истины сам. */
  readonly value?: string
  readonly onChange: (e164: string) => void
  readonly onValidate?: (isValid: boolean) => void
  readonly error?: string
  readonly disabled?: boolean
  readonly locale?: Locale
  readonly autoFocus?: boolean
}

export const PhoneInput = ({
  id,
  label,
  value,
  onChange,
  onValidate,
  error,
  disabled = false,
  locale = DEFAULT_LOCALE,
  autoFocus,
}: PhoneInputProps): ReactElement => {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const { t } = useT(locale)
  const [nationalDigits, setNationalDigits] = useState<string>(() => extractNationalDigits(value ?? ''))
  const [isFocused, setIsFocused] = useState(false)
  const [internalError, setInternalError] = useState<string | undefined>(undefined)

  const effectiveError = error ?? internalError

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = extractNationalDigits(event.target.value)
    setNationalDigits(next)
    setInternalError(undefined)
    onChange(toE164(next))
  }

  const handleBlur = (): void => {
    const isValid = nationalDigits.length === PHONE_DIGITS_REQUIRED
    setInternalError(isValid ? undefined : t('ui.phone_input.incomplete_error'))
    onValidate?.(isValid)
  }

  return (
    <FieldChrome id={inputId} label={label} error={effectiveError}>
      {(describedBy) => (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            boxSizing: 'border-box',
            height: `${String(INPUT_HEIGHT_PX)}px`,
            padding: '0 var(--space-3)',
            background: disabled ? 'var(--brand-bg)' : 'var(--brand-surface)',
            border: `1px solid ${effectiveError === undefined ? 'var(--brand-border)' : 'var(--brand-danger)'}`,
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: 'var(--font-size-base)',
              fontFamily: 'var(--brand-font-family)',
              color: 'var(--brand-text-muted)',
              userSelect: 'none',
            }}
          >
            {COUNTRY_PREFIX}
          </span>
          <input
            id={inputId}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            autoFocus={autoFocus}
            disabled={disabled}
            aria-invalid={effectiveError === undefined ? undefined : true}
            aria-describedby={describedBy}
            value={formatNationalDisplay(nationalDigits)}
            onChange={handleChange}
            onFocus={() => { setIsFocused(true) }}
            onBlur={handleBlur}
            style={{
              flex: 1,
              minWidth: 0,
              boxSizing: 'border-box',
              height: '100%',
              padding: 0,
              border: 'none',
              background: 'transparent',
              fontSize: 'var(--font-size-base)',
              fontFamily: 'var(--brand-font-family)',
              color: 'var(--brand-text)',
              // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`,
              // `focusIndicatorAuditor` — DTJ-403) — здесь фокус-кольцо переносится на сам `<input>`,
              // не на обёртку с префиксом, иначе аудитор ловит подавление без видимой замены.
              outline: isFocused ? 'none' : undefined,
              boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
            }}
          />
        </div>
      )}
    </FieldChrome>
  )
}
