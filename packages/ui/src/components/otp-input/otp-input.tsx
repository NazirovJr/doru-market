/**
 * `OtpInput` (DTJ-405, `SRS-UX-002`/`SRS-UX-019`/`SRS-UX-020`/`SRS-UX-021`/`SRS-UX-034`) —
 * `length` отдельных ячеек ввода одной цифры, `inputmode="numeric"`. Поведение — авто-переход
 * между ячейками при вводе, авто-submit `onComplete(code)` при заполнении последней ячейки,
 * `paste` распределяет вставленный код по всем ячейкам разом (демо-канвас `.dc.html:1307-1319`).
 *
 * Компонент НЕ блокирует ячейки сам после `onComplete` (см. «Риски и подводные камни» тикета) —
 * пользователь обязан иметь возможность исправить ЛЮБУЮ ячейку после авто-submit; блокировка —
 * только через явный контролируемый проп `locked` (потребитель включает его после реального
 * ответа сервера).
 *
 * Ячейки — неконтролируемый компонент (состояние — внутри), наружу отдаются только `onChange`
 * (код по мере набора) и `onComplete` (код, когда все ячейки заполнены).
 *
 * Размер ячеек: `length === 6` (логин) — 44×54px по дизайн-референсу, `length === 4` (вручение
 * курьеру) — 56×64px. `SRS-UX-002` требует ЭФФЕКТИВНУЮ область попадания ≥48×48px независимо от
 * визуала (`assertHitArea`) — ширина 44px варианта `length === 6` дополняется до 48px минимума
 * (тот же приём, что `Button`/`IconButton`: тап-зона важнее пиксель-в-пиксель визуала, см.
 * `assert-hit-area.ts` JSDoc).
 */
import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { type Locale, useT } from '@dorutj/i18n'
import { MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { DISABLED_OPACITY, buildTransition } from '../internal/motion'
import './otp-input.css'

export type OtpLength = 4 | 6

const DEFAULT_LOCALE: Locale = 'tj'
const SHAKE_DURATION_MS = 200

interface CellSize {
  readonly widthPx: number
  readonly heightPx: number
}

const CELL_SIZE_BY_LENGTH: Readonly<Record<OtpLength, CellSize>> = {
  // «логин» (44px визуал) — ширина добрана до MIN_HIT_AREA_PX (48px), высота уже ≥48px.
  6: { widthPx: MIN_HIT_AREA_PX, heightPx: 54 },
  // «вручение курьеру» — 56×64px, оба измерения уже ≥48px без корректировки.
  4: { widthPx: 56, heightPx: 64 },
}

const DIGIT_PATTERN = /^\d$/

export interface OtpInputProps {
  readonly length: OtpLength
  /** `aria-label` группы ячеек (по умолчанию читается из словаря `ui.otp_input.group_label`). */
  readonly label?: string
  readonly error?: boolean
  readonly locked?: boolean
  readonly onChange?: (code: string) => void
  readonly onComplete?: (code: string) => void
  readonly locale?: Locale
  readonly autoFocus?: boolean
}

const emptyCells = (length: OtpLength): string[] => new Array(length).fill('') as string[]

export const OtpInput = ({
  length,
  label,
  error = false,
  locked = false,
  onChange,
  onComplete,
  locale = DEFAULT_LOCALE,
  autoFocus = false,
}: OtpInputProps): ReactElement => {
  const groupId = useId()
  const { t } = useT(locale)
  const prefersReducedMotion = useReducedMotion()
  const [cells, setCells] = useState<string[]>(() => emptyCells(length))
  const [isShaking, setIsShaking] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const lastCompletedCode = useRef<string | null>(null)

  useEffect(() => {
    setCells(emptyCells(length))
    lastCompletedCode.current = null
  }, [length])

  useEffect(() => {
    if (!error || prefersReducedMotion) {
      return undefined
    }
    setIsShaking(true)
    const timeoutId = window.setTimeout(() => { setIsShaking(false) }, SHAKE_DURATION_MS)
    return () => { window.clearTimeout(timeoutId) }
  }, [error, prefersReducedMotion])

  const commit = (next: string[]): void => {
    setCells(next)
    const code = next.join('')
    onChange?.(code)
    if (code.length === length && !next.includes('') && lastCompletedCode.current !== code) {
      lastCompletedCode.current = code
      onComplete?.(code)
    } else if (next.includes('')) {
      lastCompletedCode.current = null
    }
  }

  const focusCell = (index: number): void => {
    inputRefs.current[index]?.focus()
  }

  const handleChange = (index: number) => (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value
    const digit = raw.slice(-1)
    if (digit !== '' && !DIGIT_PATTERN.test(digit)) {
      return
    }
    const next = [...cells]
    next[index] = digit
    commit(next)
    if (digit !== '' && index < length - 1) {
      focusCell(index + 1)
    }
  }

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace' && cells[index] === '' && index > 0) {
      event.preventDefault()
      const next = [...cells]
      next[index - 1] = ''
      commit(next)
      focusCell(index - 1)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault()
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    if (pasted.length === 0) {
      return
    }
    const next = emptyCells(length)
    for (let i = 0; i < pasted.length; i += 1) {
      next[i] = pasted[i] ?? ''
    }
    commit(next)
    focusCell(Math.min(pasted.length, length - 1))
  }

  const size = CELL_SIZE_BY_LENGTH[length]
  const groupLabel = label ?? t('ui.otp_input.group_label')

  return (
    <div
      role="group"
      aria-label={groupLabel}
      id={groupId}
      style={{ display: 'inline-flex', gap: 'var(--space-2)' }}
    >
      {cells.map((digit, index) => (
        <input
          // Индекс — стабильный идентификатор ячейки: число ячеек фиксировано пропом `length`,
          // это не список динамических данных, где индекс-ключ был бы антипаттерном.
          key={index}
          ref={(element) => { inputRefs.current[index] = element }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && index === 0}
          maxLength={1}
          disabled={locked}
          aria-disabled={locked ? true : undefined}
          aria-label={t('ui.otp_input.cell_label', { index: index + 1, total: length })}
          value={digit}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste}
          style={{
            boxSizing: 'border-box',
            width: `${String(size.widthPx)}px`,
            height: `${String(size.heightPx)}px`,
            textAlign: 'center',
            fontSize: 'var(--font-size-lg)',
            fontFamily: 'var(--brand-font-family)',
            color: 'var(--brand-text)',
            background: locked ? 'var(--brand-bg)' : 'var(--brand-surface)',
            border: `1px solid ${error ? 'var(--brand-danger)' : 'var(--brand-border)'}`,
            borderRadius: 'var(--radius-sm)',
            opacity: locked ? DISABLED_OPACITY : 1,
            cursor: locked ? 'not-allowed' : 'text',
            animation: isShaking ? `dorutj-otp-shake ${String(SHAKE_DURATION_MS)}ms ease` : undefined,
            transition: buildTransition(['border-color'], prefersReducedMotion),
          }}
        />
      ))}
    </div>
  )
}
