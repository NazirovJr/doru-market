import { render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { AnalogBanner } from './analog-banner.js'

const { t } = useT('ru')

const baseProps = {
  substanceName: 'Каптоприл',
  dosage: '25 мг',
  analogPriceDiram: 1250,
  referencePriceDiram: 2000,
  savingsPercent: 65,
  locale: 'ru' as const,
  t,
}

describe('AnalogBanner — inline-структура, НЕ модальная (AC3, REQ-UX-2)', () => {
  it('нет role="dialog" и нет разметки Modal в DOM', () => {
    const { container } = render(<AnalogBanner {...baseProps} />)
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
    expect(container.querySelector('.ui-modal')).not.toBeInTheDocument()
  })

  it('рендерится как обычный статичный Card (<div>), не оверлей/portal', () => {
    const { container } = render(<AnalogBanner {...baseProps} />)
    expect(container.querySelector('div.ui-card.ui-analog-banner')).toBeInTheDocument()
  })
})

describe('AnalogBanner — текст экономии по шаблону (тикет DTJ-407 п.3)', () => {
  it('интерполирует вещество/дозировку/обе цены (formatMoney)/процент', () => {
    render(<AnalogBanner {...baseProps} />)
    expect(
      screen.getByText('Тот же действующий компонент — Каптоприл 25 мг — за 12,50 сомони вместо 20,00 сомони (65% дешевле)'),
    ).toBeInTheDocument()
  })
})

describe('AnalogBanner — дисклеймер ВСЕГДА присутствует (AC3, SRS-CAT-039)', () => {
  it('дисклеймер в DOM при обычной экономии', () => {
    render(<AnalogBanner {...baseProps} />)
    expect(screen.getByText(/Это не медицинская рекомендация/)).toBeInTheDocument()
  })

  it('даже минимальная экономия (1%) — дисклеймер всё равно рендерится', () => {
    render(<AnalogBanner {...baseProps} savingsPercent={1} />)
    expect(screen.getByText(/Это не медицинская рекомендация/)).toBeInTheDocument()
  })
})

describe('AnalogBanner — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<AnalogBanner {...baseProps} />)
    expect(axeResults).toHaveNoViolations()
  })
})
