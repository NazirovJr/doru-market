import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactElement, RefObject } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './otp-input.css'

export type OtpLength = 4 | 6
const LOGIN_LENGTH: OtpLength = 6
const COURIER_LENGTH: OtpLength = 4

export interface OtpInputProps {
  /** `4` — вручение курьеру, `6` — логин (`SRS-UX-021`). Определяет и визуальный размер ячеек:
   * логин 44×54px, курьер 56×64px (`DTJ-405` п.2). */
  readonly length: OtpLength
  /** Auto-submit — вызывается РОВНО при том вводе, который делает код полностью заполненным
   * (последняя цифра при последовательном вводе, ЛЮБОЙ ввод/paste при заполнении всех ячеек). */
  readonly onComplete: (code: string) => void
  /** Все ячейки визуально приглушены и не принимают ввод — управляется ТОЛЬКО потребителем после
   * реального ответа сервера, компонент сам себя не блокирует после `onComplete` (см. «Риски»
   * `DTJ-405`: пользователь обязан иметь возможность исправить любую цифру после auto-submit). */
  readonly locked?: boolean
  /** Тряска `shakeX` ≤200мс (уважает `useReducedMotion`) + визуальная рамка ошибки. */
  readonly error?: boolean
  /** Доступное имя группы ячеек (`role="group"`) — переведённый текст потребителя, например
   * «Код подтверждения». Каждая ячейка получает `aria-label` `${label} N` (число — не строка,
   * не требует i18n). */
  readonly label: string
  readonly id?: string
}

interface CellDimensions {
  readonly widthPx: number
  readonly heightPx: number
}

/** Визуальные размеры ячеек по `length` (`DTJ-405` п.2): логин (6) — 44×54px, курьер (4) —
 * 56×64px. Единственное место, где эти числа объявлены. */
const CELL_DIMENSIONS: Readonly<Record<OtpLength, CellDimensions>> = {
  [LOGIN_LENGTH]: { widthPx: 44, heightPx: 54 },
  [COURIER_LENGTH]: { widthPx: 56, heightPx: 64 },
}

function getCellDimensions(length: OtpLength): CellDimensions {
  return CELL_DIMENSIONS[length]
}

function extractPastedDigits(text: string, length: OtpLength): string {
  return text.replace(/\D/g, '').slice(0, length)
}

interface UseOtpCellsResult {
  readonly digits: readonly string[]
  readonly cellRefs: RefObject<(HTMLInputElement | null)[]>
  readonly handleChange: (index: number) => (event: ChangeEvent<HTMLInputElement>) => void
  readonly handleKeyDown: (index: number) => (event: KeyboardEvent<HTMLInputElement>) => void
  readonly handlePaste: (event: ClipboardEvent<HTMLInputElement>) => void
}

function useOtpCells(length: OtpLength, locked: boolean, onComplete: (code: string) => void): UseOtpCellsResult {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ''))
  const cellRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    setDigits(Array.from({ length }, () => ''))
  }, [length])

  const commit = (nextDigits: string[]): void => {
    setDigits(nextDigits)
    if (nextDigits.every((digit) => digit !== '')) {
      onComplete(nextDigits.join(''))
    }
  }

  const handleChange =
    (index: number) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      if (locked) {
        return
      }
      const raw = event.target.value.replace(/\D/g, '').slice(-1)
      const nextDigits = [...digits]
      nextDigits[index] = raw
      commit(nextDigits)
      if (raw !== '' && index < length - 1) {
        cellRefs.current[index + 1]?.focus()
      }
    }

  const handleKeyDown =
    (index: number) =>
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (locked) {
        return
      }
      if (event.key === 'Backspace' && digits[index] === '' && index > 0) {
        cellRefs.current[index - 1]?.focus()
      }
    }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    if (locked) {
      return
    }
    event.preventDefault()
    const pastedDigits = extractPastedDigits(event.clipboardData.getData('text'), length)
    if (pastedDigits.length === 0) {
      return
    }
    const nextDigits = Array.from({ length }, (_, index) => pastedDigits[index] ?? '')
    commit(nextDigits)
    const lastFilledIndex = Math.min(pastedDigits.length, length - 1)
    cellRefs.current[lastFilledIndex]?.focus()
  }

  return { digits, cellRefs, handleChange, handleKeyDown, handlePaste }
}

/**
 * `OtpInput` (`SRS-UX-021`) — 4/6 отдельных ячеек `inputmode="numeric"`, авто-переход между
 * ячейками, авто-submit на заполнении последней. Редактирование ЛЮБОЙ ячейки после `onComplete`
 * остаётся доступным — блокировка только через явный `locked` (`DTJ-405` «Риски»).
 */
export const OtpInput = ({ length, onComplete, locked = false, error = false, label, id }: OtpInputProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const { digits, cellRefs, handleChange, handleKeyDown, handlePaste } = useOtpCells(length, locked, onComplete)
  const { widthPx, heightPx } = getCellDimensions(length)
  const groupId = id ?? label

  return (
    <div
      role="group"
      aria-label={label}
      className={cx('ui-otp', error && !prefersReducedMotion && 'ui-otp--shake', error && 'ui-otp--error')}
      data-testid={groupId}
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            cellRefs.current[index] = node
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          aria-label={`${label} ${String(index + 1)}`}
          aria-disabled={locked || undefined}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste}
          style={{ width: `${String(widthPx)}px`, height: `${String(heightPx)}px` }}
          className={cx(
            'ui-otp__cell',
            error && 'ui-otp__cell--error',
            locked && 'ui-otp__cell--locked',
            !prefersReducedMotion && 'ui-otp__cell--motion',
          )}
        />
      ))}
    </div>
  )
}
