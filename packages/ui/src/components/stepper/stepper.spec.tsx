/**
 * `stepper.spec.tsx` (DTJ-408, тест-план тикета).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Stepper, type StepperStep } from './stepper'

afterEach(() => {
  cleanup()
})

const STEPS: readonly StepperStep[] = [
  { label: 'Адрес', status: 'complete' },
  { label: 'Оплата', status: 'current' },
  { label: 'Подтверждение', status: 'upcoming' },
]

describe('Stepper — визуальное различие состояний не только цветом', () => {
  it('рендерит подпись каждого шага', () => {
    render(<Stepper steps={STEPS} />)
    expect(screen.getByText('Адрес')).toBeInTheDocument()
    expect(screen.getByText('Оплата')).toBeInTheDocument()
    expect(screen.getByText('Подтверждение')).toBeInTheDocument()
  })

  it('complete-шаг рендерит галочку (svg-иконку), не номер — форма маркера отличается', () => {
    render(<Stepper steps={STEPS} />)
    const items = screen.getAllByRole('listitem')
    const completeItem = items[0]
    expect(completeItem?.querySelector('svg')).not.toBeNull()
  })

  it('upcoming-шаг рендерит номер, не галочку', () => {
    render(<Stepper steps={STEPS} />)
    const items = screen.getAllByRole('listitem')
    const upcomingItem = items[2]
    expect(upcomingItem?.querySelector('svg')).toBeNull()
    expect(upcomingItem).toHaveTextContent('3')
  })

  it('текущий шаг помечен aria-current="step", остальные — нет', () => {
    render(<Stepper steps={STEPS} />)
    const items = screen.getAllByRole('listitem')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[0]).not.toHaveAttribute('aria-current')
    expect(items[2]).not.toHaveAttribute('aria-current')
  })
})

describe('Stepper — доступность', () => {
  it('нулевые critical/serious нарушения', async () => {
    const { axeResults } = await renderWithA11yCheck(<Stepper steps={STEPS} />)
    assertNoBlockingViolations(axeResults)
  })
})
