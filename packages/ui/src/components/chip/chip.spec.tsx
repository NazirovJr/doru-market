/**
 * `chip.spec.tsx` (DTJ-404, критерий приёмки 4, тест-план тикета).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_HIT_AREA_PX, assertHitArea } from '@/a11y/assert-hit-area'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Chip } from './chip'

afterEach(() => {
  cleanup()
})

describe('Chip — эффективная тап-зона при визуальной высоте 32px (AC4)', () => {
  it('assertHitArea проходит (≥48×48px), несмотря на компактный визуал', () => {
    render(<Chip selected={false}>В наличии</Chip>)
    assertHitArea(screen.getByRole('button', { name: 'В наличии' }), MIN_HIT_AREA_PX)
  })

  it('assertHitArea проходит и для короткого текста (ширина не зависит от контента)', () => {
    render(<Chip selected>24ч</Chip>)
    assertHitArea(screen.getByRole('button', { name: '24ч' }), MIN_HIT_AREA_PX)
  })
})

describe('Chip — переключение selected (aria-pressed)', () => {
  it('aria-pressed отражает selected и меняется по клику через onToggle', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <Chip selected={false} onToggle={onToggle}>
        Открыто сейчас
      </Chip>,
    )
    const chip = screen.getByRole('button', { name: 'Открыто сейчас' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(chip)
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(
      <Chip selected onToggle={onToggle}>
        Открыто сейчас
      </Chip>,
    )
    expect(screen.getByRole('button', { name: 'Открыто сейчас' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Chip — focus', () => {
  it('показывает --focus-ring при фокусе и убирает при blur', () => {
    render(<Chip selected={false}>В наличии</Chip>)
    const chip = screen.getByRole('button', { name: 'В наличии' })
    fireEvent.focus(chip)
    expect(getComputedStyle(chip).boxShadow).toContain('var(--focus-ring)')
    fireEvent.blur(chip)
    expect(getComputedStyle(chip).boxShadow).toBe('none')
  })
})

describe('Chip — доступность', () => {
  it('нулевые critical/serious нарушения', async () => {
    const { axeResults } = await renderWithA11yCheck(<Chip selected={false}>В наличии</Chip>)
    assertNoBlockingViolations(axeResults)
  })
})
