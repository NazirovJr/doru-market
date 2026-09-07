import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Checkbox } from './checkbox.js'

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

describe('Checkbox — эффективная область попадания (AC5)', () => {
  it('видимый размер 20×20px — эффективная область ≥48×48px через hit-slop', () => {
    render(<Checkbox label="Согласен с условиями" checked={false} onChange={() => undefined} />)
    const label = screen.getByRole('checkbox', { name: 'Согласен с условиями' }).closest('label')
    expect(label).not.toBeNull()
    if (label) {
      label.getBoundingClientRect = () => createRect(200, 20)
      expect(getComputedStyle(label).paddingTop).toBe('14px')
      assertHitArea(label, 48)
    }
  })
})

describe('Checkbox — семантика и управляемость', () => {
  it('визуальный чекбокс построен поверх нативного input[type=checkbox]', () => {
    render(<Checkbox label="Согласен" checked={false} onChange={() => undefined} />)
    const input = screen.getByRole('checkbox', { name: 'Согласен' })
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAttribute('type', 'checkbox')
  })

  it('клик вызывает onChange, checked не меняется без потребителя (controlled)', () => {
    const onChange = vi.fn()
    render(<Checkbox label="Согласен" checked={false} onChange={onChange} />)
    const input = screen.getByRole('checkbox', { name: 'Согласен' })

    fireEvent.click(input)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(input).not.toBeChecked()
  })

  it('checked=true рендерит отмеченное состояние', () => {
    render(<Checkbox label="Согласен" checked onChange={() => undefined} />)
    expect(screen.getByRole('checkbox', { name: 'Согласен' })).toBeChecked()
  })
})

describe('Checkbox — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Checkbox label="Согласен с условиями" checked={false} onChange={() => undefined} />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
