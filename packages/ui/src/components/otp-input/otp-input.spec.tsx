import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { OtpInput } from './otp-input.js'

function getCells(label: string): HTMLInputElement[] {
  return screen.getAllByLabelText(new RegExp(`^${label} \\d$`))
}

function getCell(cells: readonly HTMLInputElement[], index: number): HTMLInputElement {
  const cell = cells[index]
  if (cell === undefined) {
    throw new Error(`Ячейка с индексом ${String(index)} не найдена`)
  }
  return cell
}

describe('OtpInput — auto-переход и auto-submit (AC1)', () => {
  it('length=6: ввод 6 цифр подряд вызывает onComplete РОВНО один раз с полной строкой', () => {
    const onComplete = vi.fn()
    render(<OtpInput length={6} onComplete={onComplete} label="Код" />)
    const cells = getCells('Код')
    expect(cells).toHaveLength(6)

    '123456'.split('').forEach((digit, index) => {
      fireEvent.change(getCell(cells, index), { target: { value: digit } })
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('ввод цифры переводит фокус на следующую ячейку автоматически', () => {
    render(<OtpInput length={4} onComplete={() => undefined} label="Код" />)
    const cells = getCells('Код')

    fireEvent.change(getCell(cells, 0), { target: { value: '1' } })
    expect(getCell(cells, 1)).toHaveFocus()
  })

  it('Backspace на пустой ячейке возвращает фокус на предыдущую', () => {
    render(<OtpInput length={4} onComplete={() => undefined} label="Код" />)
    const cells = getCells('Код')
    getCell(cells, 1).focus()

    fireEvent.keyDown(getCell(cells, 1), { key: 'Backspace' })
    expect(getCell(cells, 0)).toHaveFocus()
  })
})

describe('OtpInput — paste (AC2)', () => {
  it('length=4: paste «1234» в первую ячейку заполняет все 4 и вызывает onComplete', () => {
    const onComplete = vi.fn()
    render(<OtpInput length={4} onComplete={onComplete} label="Код курьера" />)
    const cells = getCells('Код курьера')

    fireEvent.paste(getCell(cells, 0), { clipboardData: { getData: () => '1234' } })

    expect(cells.map((cell) => cell.value)).toEqual(['1', '2', '3', '4'])
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('1234')
  })

  it('paste с нецифровыми символами и лишней длиной — берутся только первые N цифр', () => {
    const onComplete = vi.fn()
    render(<OtpInput length={4} onComplete={onComplete} label="Код курьера" />)
    const cells = getCells('Код курьера')

    fireEvent.paste(getCell(cells, 0), { clipboardData: { getData: () => '12-34-56' } })

    expect(cells.map((cell) => cell.value)).toEqual(['1', '2', '3', '4'])
    expect(onComplete).toHaveBeenCalledWith('1234')
  })
})

describe('OtpInput — paste без цифр', () => {
  it('paste без единой цифры не меняет ячейки и не вызывает onComplete', () => {
    const onComplete = vi.fn()
    render(<OtpInput length={4} onComplete={onComplete} label="Код" />)
    const cells = getCells('Код')

    fireEvent.paste(getCell(cells, 0), { clipboardData: { getData: () => 'abc' } })

    cells.forEach((cell) => {
      expect(cell.value).toBe('')
    })
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('OtpInput — locked (AC3)', () => {
  it('ввод в любую ячейку не меняет значение, aria-disabled="true" на каждой ячейке', () => {
    render(<OtpInput length={4} onComplete={() => undefined} label="Код" locked />)
    const cells = getCells('Код')

    fireEvent.change(getCell(cells, 0), { target: { value: '5' } })

    cells.forEach((cell) => {
      expect(cell).toHaveAttribute('aria-disabled', 'true')
      expect(cell.value).toBe('')
    })
  })

  it('Backspace игнорируется в locked-состоянии (фокус не переходит на предыдущую)', () => {
    render(<OtpInput length={4} onComplete={() => undefined} label="Код" locked />)
    const cells = getCells('Код')
    getCell(cells, 1).focus()

    fireEvent.keyDown(getCell(cells, 1), { key: 'Backspace' })

    expect(getCell(cells, 1)).toHaveFocus()
  })

  it('paste игнорируется в locked-состоянии', () => {
    render(<OtpInput length={4} onComplete={() => undefined} label="Код" locked />)
    const cells = getCells('Код')

    fireEvent.paste(getCell(cells, 0), { clipboardData: { getData: () => '1234' } })

    cells.forEach((cell) => {
      expect(cell.value).toBe('')
    })
  })

  it('редактирование остаётся доступным ПОСЛЕ onComplete, пока locked не выставлен явно', () => {
    const onComplete = vi.fn()
    render(<OtpInput length={4} onComplete={onComplete} label="Код" />)
    const cells = getCells('Код')

    '1234'.split('').forEach((digit, index) => {
      fireEvent.change(getCell(cells, index), { target: { value: digit } })
    })
    expect(onComplete).toHaveBeenCalledTimes(1)

    fireEvent.change(getCell(cells, 0), { target: { value: '9' } })
    expect(getCell(cells, 0).value).toBe('9')
  })
})

describe('OtpInput — визуальные размеры по length', () => {
  it('length=6 (логин) — ячейки 44×54px', () => {
    render(<OtpInput length={6} onComplete={() => undefined} label="Код" />)
    const cell = getCell(getCells('Код'), 0)
    expect(cell.style.width).toBe('44px')
    expect(cell.style.height).toBe('54px')
  })

  it('length=4 (курьер) — ячейки 56×64px', () => {
    render(<OtpInput length={4} onComplete={() => undefined} label="Код" />)
    const cell = getCell(getCells('Код'), 0)
    expect(cell.style.width).toBe('56px')
    expect(cell.style.height).toBe('64px')
  })
})

describe('OtpInput — доступность', () => {
  it('ноль critical/serious a11y-нарушений: default/error/locked', async () => {
    const defaultResult = await renderWithA11yCheck(<OtpInput length={6} onComplete={() => undefined} label="Код" />)
    expect(defaultResult.axeResults).toHaveNoViolations()

    const errorResult = await renderWithA11yCheck(
      <OtpInput length={6} onComplete={() => undefined} label="Код" error />,
    )
    expect(errorResult.axeResults).toHaveNoViolations()

    const lockedResult = await renderWithA11yCheck(
      <OtpInput length={6} onComplete={() => undefined} label="Код" locked />,
    )
    expect(lockedResult.axeResults).toHaveNoViolations()
  })
})
