import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { assertHitArea, renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Chip } from './chip.js'

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

describe('Chip — эффективная область попадания (AC4)', () => {
  it('визуальная высота 32px — эффективная область ≥48×48px через hit-slop', () => {
    render(<Chip selected={false}>В наличии</Chip>)
    const chip = screen.getByRole('button', { name: 'В наличии' })
    chip.getBoundingClientRect = () => createRect(80, 32)

    expect(getComputedStyle(chip).paddingTop).toBe('8px')
    expect(getComputedStyle(chip).paddingBottom).toBe('8px')
    assertHitArea(chip, 48)
  })
})

describe('Chip — переключение', () => {
  it('selected=false → aria-pressed="false"', () => {
    render(<Chip selected={false}>Открыто сейчас</Chip>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  })

  it('selected=true → aria-pressed="true", визуальный класс --selected', () => {
    render(<Chip selected>Открыто сейчас</Chip>)
    const chip = screen.getByRole('button')
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip.className).toContain('ui-chip--selected')
  })

  it('клик по чипу вызывает onClick потребителя (переключение состояния — его ответственность)', () => {
    const onClick = vi.fn()
    render(
      <Chip selected={false} onClick={onClick}>
        24ч
      </Chip>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Chip — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<Chip selected={false}>В наличии</Chip>)
    expect(axeResults).toHaveNoViolations()
  })
})
