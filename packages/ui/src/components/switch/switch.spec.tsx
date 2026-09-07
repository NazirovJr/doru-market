import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Switch } from './switch.js'

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

describe('Switch — ARIA (role=switch, aria-checked)', () => {
  it('off: role="switch", aria-checked="false"', () => {
    render(<Switch label="Уведомления" checked={false} onChange={() => undefined} />)
    const toggle = screen.getByRole('switch', { name: 'Уведомления' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('on: aria-checked="true", визуальный класс --checked', () => {
    render(<Switch label="Уведомления" checked onChange={() => undefined} />)
    const toggle = screen.getByRole('switch', { name: 'Уведомления' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle.className).toContain('ui-switch--checked')
  })
})

describe('Switch — управляемость', () => {
  it('клик вызывает onChange с инвертированным значением, aria-checked не меняется без потребителя', () => {
    const onChange = vi.fn()
    render(<Switch label="Уведомления" checked={false} onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Уведомления' })

    fireEvent.click(toggle)

    expect(onChange).toHaveBeenCalledWith(true)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('disabled — клик не вызывает onChange', () => {
    const onChange = vi.fn()
    render(<Switch label="Уведомления" checked={false} onChange={onChange} disabled />)
    const toggle = screen.getByRole('switch', { name: 'Уведомления' })

    fireEvent.click(toggle)

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Switch — эффективная область попадания', () => {
  it('видимый трек 24px высотой — эффективная область ≥48×48px через hit-slop', () => {
    render(<Switch label="Уведомления" checked={false} onChange={() => undefined} />)
    const toggle = screen.getByRole('switch', { name: 'Уведомления' })
    toggle.getBoundingClientRect = () => createRect(44, 24)

    expect(getComputedStyle(toggle).paddingTop).toBe('12px')
    assertHitArea(toggle, 48)
  })
})

describe('Switch — доступность', () => {
  it('ноль critical/serious a11y-нарушений (off/on/disabled)', async () => {
    const offResult = await renderWithA11yCheck(<Switch label="Уведомления" checked={false} onChange={() => undefined} />)
    expect(offResult.axeResults).toHaveNoViolations()

    const onResult = await renderWithA11yCheck(<Switch label="Уведомления" checked onChange={() => undefined} />)
    expect(onResult.axeResults).toHaveNoViolations()

    const disabledResult = await renderWithA11yCheck(
      <Switch label="Уведомления" checked={false} onChange={() => undefined} disabled />,
    )
    expect(disabledResult.axeResults).toHaveNoViolations()
  })
})
