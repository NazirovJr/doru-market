/**
 * `card.spec.tsx` (DTJ-404, тест-план тикета: «interactive рендерит фокусируемый элемент с
 * видимым --focus-ring при :focus-visible; static не фокусируется Tab-ом»).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Card } from './card'

afterEach(() => {
  cleanup()
})

describe('Card — static', () => {
  it('рендерит div, не фокусируемый Tab-ом', () => {
    render(<Card>Контент карточки</Card>)
    const node = screen.getByText('Контент карточки')
    expect(node.tagName).toBe('DIV')
    expect(node).not.toHaveAttribute('tabindex')
  })

  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(<Card>Контент карточки</Card>)
    assertNoBlockingViolations(axeResults)
  })
})

describe('Card — interactive', () => {
  it('без href рендерит фокусируемый button и показывает --focus-ring при фокусе', () => {
    render(
      <Card interactive aria-label="Открыть препарат">
        Парацетамол 500мг
      </Card>,
    )
    const card = screen.getByRole('button', { name: 'Открыть препарат' })
    fireEvent.focus(card)
    expect(getComputedStyle(card).boxShadow).toContain('var(--focus-ring)')
    fireEvent.blur(card)
    expect(getComputedStyle(card).boxShadow).toBe('none')
  })

  it('с href рендерит ссылку <a>', () => {
    render(
      <Card interactive href="/medicine/1">
        Парацетамол 500мг
      </Card>,
    )
    const link = screen.getByRole('link', { name: 'Парацетамол 500мг' })
    expect(link).toHaveAttribute('href', '/medicine/1')
    fireEvent.focus(link)
    expect(getComputedStyle(link).boxShadow).toContain('var(--focus-ring)')
  })

  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Card interactive aria-label="Открыть препарат">
        Парацетамол 500мг
      </Card>,
    )
    assertNoBlockingViolations(axeResults)
  })
})
