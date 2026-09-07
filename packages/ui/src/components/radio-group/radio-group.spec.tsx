import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { RadioGroup } from './radio-group.js'

const OPTIONS = [
  { value: 'card', label: 'Картой онлайн' },
  { value: 'cash', label: 'Наличными курьеру' },
]

function createRect(widthPx: number, heightPx: number): DOMRect {
  return {
    width: widthPx,
    height: heightPx,
    top: 0,
    left: 0,
    right: widthPx,
    bottom: heightPx,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
}

describe('RadioGroup — роль и ARIA', () => {
  it('role="radiogroup" с доступным именем через aria-labelledby', () => {
    render(<RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value={null} onChange={() => undefined} />)
    expect(screen.getByRole('radiogroup', { name: 'Способ оплаты' })).toBeInTheDocument()
  })

  it('текущее значение отражается через checked на нативном radio', () => {
    render(<RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value="cash" onChange={() => undefined} />)
    expect(screen.getByRole('radio', { name: 'Наличными курьеру' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Картой онлайн' })).not.toBeChecked()
  })
})

describe('RadioGroup — управляемость', () => {
  it('клик по опции вызывает onChange, значение не меняется без потребителя', () => {
    const onChange = vi.fn()
    render(<RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value={null} onChange={onChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Картой онлайн' }))

    expect(onChange).toHaveBeenCalledWith('card')
    expect(screen.getByRole('radio', { name: 'Картой онлайн' })).not.toBeChecked()
  })

  it('нативная семантика radio: смена value извне отражается в checked', () => {
    const { rerender } = render(
      <RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value={null} onChange={() => undefined} />,
    )
    rerender(<RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value="card" onChange={() => undefined} />)
    expect(screen.getByRole('radio', { name: 'Картой онлайн' })).toBeChecked()
  })
})

describe('RadioGroup — эффективная область попадания', () => {
  it('визуальный кружок 20px высотой — эффективная область ≥48×48px через inline hit-slop', () => {
    render(<RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value={null} onChange={() => undefined} />)
    const label = screen.getByRole('radio', { name: 'Картой онлайн' }).closest('label')
    expect(label).not.toBeNull()
    if (label) {
      label.getBoundingClientRect = () => createRect(160, 20)
      expect(getComputedStyle(label).paddingTop).toBe('14px')
      expect(getComputedStyle(label).paddingBottom).toBe('14px')
      assertHitArea(label, 48)
    }
  })
})

describe('RadioGroup — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value={null} onChange={() => undefined} />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
