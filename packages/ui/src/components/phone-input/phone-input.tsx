import { useId, useState } from 'react'
import type { ChangeEvent, FocusEvent, InputHTMLAttributes, ReactElement } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import { FieldError } from '../input/field-error.js'
import { getFieldDescribedBy } from '../input/field-shared.js'
import '../input/input.css'
import './phone-input.css'

const COUNTRY_CODE = '+992'
const COUNTRY_CALLING_CODE_DIGITS = '992'
const LOCAL_DIGITS_LENGTH = 9
/** Группы маски `XX XXX XX XX` для оставшихся 9 цифр (`SRS-DOM-069`) — объект, не массив: числа —
 * значения свойств объекта, присвоенного `const` (`@typescript-eslint/no-magic-numbers` не
 * освобождает элементы литерала массива, см. отчёт `DTJ-405`). */
const MASK_GROUP_LENGTHS = { first: 2, second: 3, third: 2, fourth: 2 }

export interface PhoneInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'defaultValue' | 'type'> {
  readonly label: string
  /** Текст ошибки — ПОЛНОСТЬЮ на стороне потребителя (как у `Input`), компонент ничего не
   * хардкодит сам (`AGENTS.md` §9 — ноль строк без i18n). Практическое применение: потребитель
   * подписывается на `onValidate(false)` и передаёт сюда переведённый текст. */
  readonly error?: string
  readonly id?: string
  /** Начальное значение — цифры без `+992` (uncontrolled по природе, `SRS-UX-021`: компонент сам
   * держит визуальное форматированное отображение, наружу отдаёт только normalized строку). */
  readonly defaultValue?: string
  /** Нормализованная E.164-подобная строка `+992XXXXXXXXX` (полная или частичная по мере ввода). */
  readonly onChange: (normalizedValue: string) => void
  /** Вызывается на `blur` — `true`, если введены все 9 цифр (`SRS-DOM-069` формат `PhoneNumber`). */
  readonly onValidate?: (isValid: boolean) => void
}

function extractDigits(rawValue: string, initial: string | undefined): string {
  const source = initial ?? rawValue
  const digitsOnly = source.replace(/\D/g, '')
  const withoutCountryCode = digitsOnly.startsWith(COUNTRY_CALLING_CODE_DIGITS)
    ? digitsOnly.slice(COUNTRY_CALLING_CODE_DIGITS.length)
    : digitsOnly
  return withoutCountryCode.slice(0, LOCAL_DIGITS_LENGTH)
}

function formatLocalPart(digits: string): string {
  const groups: string[] = []
  let cursor = 0
  for (const groupLength of Object.values(MASK_GROUP_LENGTHS)) {
    if (cursor >= digits.length) {
      break
    }
    groups.push(digits.slice(cursor, cursor + groupLength))
    cursor += groupLength
  }
  return groups.join(' ')
}

/** Полное визуальное значение поля (`+992 90 123 45 67`) — используется в Storybook/тестах для
 * сверки с AC4, само поле рендерит префикс и маскированную часть отдельными узлами. */
export function formatDisplayValue(digits: string): string {
  const localPart = formatLocalPart(digits)
  return localPart.length > 0 ? `${COUNTRY_CODE} ${localPart}` : COUNTRY_CODE
}

/**
 * Телефон РТ (`SRS-UX-021`, `SRS-DOM-069`). Неизменяемый префикс `+992` — статичный текст рядом с
 * полем (не редактируемый пользователем внутри `<input>`), поле принимает только оставшиеся 9
 * цифр и форматирует их маской `XX XXX XX XX` для отображения; наружу — только нормализованное
 * значение. Финальная валидация формата — всегда на сервере (`VO PhoneNumber`), этот компонент
 * только даёт мгновенную обратную связь.
 */
export const PhoneInput = ({
  label,
  error,
  id,
  defaultValue,
  onChange,
  onValidate,
  onBlur,
  className,
  ...rest
}: PhoneInputProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const errorId = error !== undefined ? `${fieldId}-error` : undefined
  const [digits, setDigits] = useState(() => extractDigits('', defaultValue))

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextDigits = extractDigits(event.target.value, undefined)
    setDigits(nextDigits)
    onChange(nextDigits.length > 0 ? `${COUNTRY_CODE}${nextDigits}` : '')
  }

  const handleBlur = (event: FocusEvent<HTMLInputElement>): void => {
    onValidate?.(digits.length === LOCAL_DIGITS_LENGTH)
    onBlur?.(event)
  }

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <div className="ui-phone-input">
        {/* Не `aria-hidden` — screen reader обязан озвучить префикс перед значением поля, иначе
         * пользователь не понимает код страны из одних цифр (`SRS-UX-034` «доступное имя»). */}
        <span className="ui-phone-input__prefix">{COUNTRY_CODE}</span>
        <input
          {...rest}
          id={fieldId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={formatLocalPart(digits)}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={error !== undefined || undefined}
          aria-describedby={getFieldDescribedBy(errorId, rest['aria-describedby'])}
          className={cx(
            'ui-field__control',
            'ui-phone-input__control',
            error !== undefined && 'ui-field__control--error',
            !prefersReducedMotion && 'ui-field__control--motion',
            className,
          )}
        />
      </div>
      {error !== undefined ? <FieldError id={errorId ?? `${fieldId}-error`} message={error} /> : null}
    </div>
  )
}
