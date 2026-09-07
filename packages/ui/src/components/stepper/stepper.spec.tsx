import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Stepper, type StepItem } from './stepper.js'

const STEPS: readonly StepItem[] = [
  { label: 'Адрес', status: 'complete' },
  { label: 'Оплата', status: 'current' },
  { label: 'Подтверждение', status: 'upcoming' },
]

describe('Stepper — визуальное различие состояний не только цветом', () => {
  it('complete-шаг рендерит галочку (svg), не просто номер', () => {
    render(<Stepper steps={STEPS} aria-label="Прогресс оформления" />);
    const completeStep = screen.getByText('Адрес').closest('li')
    expect(completeStep?.querySelector('svg')).not.toBeNull()
    expect(completeStep).toHaveClass('ui-stepper__step--complete')
  })

  it('current-шаг рендерит номер (не svg) и aria-current="step"', () => {
    render(<Stepper steps={STEPS} aria-label="Прогресс оформления" />)
    const currentStep = screen.getByText('Оплата').closest('li')
    expect(currentStep?.querySelector('svg')).toBeNull()
    expect(currentStep).toHaveTextContent('2')
    expect(currentStep).toHaveAttribute('aria-current', 'step')
    expect(currentStep).toHaveClass('ui-stepper__step--current')
  })

  it('upcoming-шаг рендерит номер, без aria-current и без galочки', () => {
    render(<Stepper steps={STEPS} aria-label="Прогресс оформления" />)
    const upcomingStep = screen.getByText('Подтверждение').closest('li')
    expect(upcomingStep?.querySelector('svg')).toBeNull()
    expect(upcomingStep).toHaveTextContent('3')
    expect(upcomingStep).not.toHaveAttribute('aria-current')
    expect(upcomingStep).toHaveClass('ui-stepper__step--upcoming')
  })

  it('три состояния получают три РАЗНЫХ CSS-класса (не совпадают попарно)', () => {
    render(<Stepper steps={STEPS} aria-label="Прогресс оформления" />)
    const classes = STEPS.map((step) => screen.getByText(step.label).closest('li')?.className)
    expect(new Set(classes).size).toBe(3)
  })
})

describe('Stepper — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<Stepper steps={STEPS} aria-label="Прогресс оформления" />)
    expect(axeResults).toHaveNoViolations()
  })
})
