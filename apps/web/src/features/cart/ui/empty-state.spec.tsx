import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EmptyState } from './empty-state'

const MIN_TAP_ZONE_CLASS = ['min-h-12', 'min-w-12']

describe('EmptyState (DTJ-234, AC3)', () => {
  it('1. рендерит переданное сообщение и текст CTA', () => {
    render(<EmptyState message="Корзина пуста." ctaLabel="Найти лекарство" onCtaClick={vi.fn()} />)
    expect(screen.getByText('Корзина пуста.')).toBeInTheDocument()
    expect(screen.getByTestId('cart-empty-cta')).toHaveTextContent('Найти лекарство')
  })

  it('2. клик по CTA вызывает onCtaClick', () => {
    const onCtaClick = vi.fn()
    render(<EmptyState message="msg" ctaLabel="cta" onCtaClick={onCtaClick} />)
    fireEvent.click(screen.getByTestId('cart-empty-cta'))
    expect(onCtaClick).toHaveBeenCalledTimes(1)
  })

  it('3. [AC4, SRS-UX-002] CTA несёt классы тап-зоны ≥48×48px (min-h-12/min-w-12 = 48px)', () => {
    render(<EmptyState message="msg" ctaLabel="cta" onCtaClick={vi.fn()} />)
    const cta = screen.getByTestId('cart-empty-cta')
    for (const className of MIN_TAP_ZONE_CLASS) {
      expect(cta).toHaveClass(className)
    }
  })
})
