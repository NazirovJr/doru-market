/**
 * `otp-input.spec.tsx` (DTJ-405, критерии приёмки 1-3, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { OtpInput } from './otp-input'

afterEach(() => {
  cleanup()
})

const getCells = (): HTMLInputElement[] => screen.getAllByRole<HTMLInputElement>('textbox')

describe('OtpInput — авто-переход и авто-submit (AC1)', () => {
  it('авто-переходит между ячейками при вводе и вызывает onComplete РОВНО один раз с полным кодом', () => {
    const onComplete = vi.fn()
    render(<OtpInput length={6} onComplete={onComplete} />)
    const cells = getCells()
    expect(cells).toHaveLength(6)

    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(cells[index]!, { target: { value: digit } })
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('123456')
    expect(document.activeElement).toBe(cells[5])
  })

  it('игнорирует нечисловой ввод', () => {
    const onChange = vi.fn()
    render(<OtpInput length={4} onChange={onChange} />)
    const [first] = getCells()
    fireEvent.change(first!, { target: { value: 'a' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Backspace на пустой ячейке возвращает фокус на предыдущую и очищает её', () => {
    render(<OtpInput length={4} />)
    const cells = getCells()
    fireEvent.change(cells[0]!, { target: { value: '1' } })
    cells[1]!.focus()
    fireEvent.keyDown(cells[1]!, { key: 'Backspace' })
    expect(document.activeElement).toBe(cells[0])
    expect(cells[0]).toHaveValue('')
  })
})

describe('OtpInput — paste (AC2)', () => {
  it('распределяет вставленный код по всем ячейкам и вызывает onComplete', () => {
    const onComplete = vi.fn()
    render(<OtpInput length={4} onComplete={onComplete} />)
    const cells = getCells()
    fireEvent.paste(cells[0]!, {
      clipboardData: { getData: () => '1234' },
    })
    expect(cells.map((cell) => cell.value)).toEqual(['1', '2', '3', '4'])
    expect(onComplete).toHaveBeenCalledWith('1234')
  })
})

describe('OtpInput — locked (AC3)', () => {
  it('блокирует ввод и выставляет aria-disabled="true" на каждой ячейке', () => {
    render(<OtpInput length={4} locked />)
    const cells = getCells()
    for (const cell of cells) {
      expect(cell).toHaveAttribute('aria-disabled', 'true')
      expect(cell).toBeDisabled()
    }
  })

  it('после locked редактирование ЛЮБОЙ ячейки остаётся возможным, если locked снят потребителем', () => {
    const { rerender } = render(<OtpInput length={4} locked onChange={vi.fn()} />)
    rerender(<OtpInput length={4} locked={false} onChange={vi.fn()} />)
    const cells = getCells()
    fireEvent.change(cells[0]!, { target: { value: '9' } })
    expect(cells[0]).toHaveValue('9')
  })
})

describe('OtpInput — доступность (3 состояния)', () => {
  it('default — ноль critical/serious нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<OtpInput length={4} />)
    assertNoBlockingViolations(axeResults)
  })

  it('error — ноль critical/serious нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<OtpInput length={4} error />)
    assertNoBlockingViolations(axeResults)
  })

  it('locked — ноль critical/serious нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<OtpInput length={4} locked />)
    assertNoBlockingViolations(axeResults)
  })
})
