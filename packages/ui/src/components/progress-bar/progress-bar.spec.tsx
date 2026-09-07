import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { ProgressBar } from './progress-bar.js'

describe('ProgressBar — значение 0-100%', () => {
  it('рендерит aria-valuenow равным value', () => {
    render(<ProgressBar value={42} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  it('обрезает значения выше 100 до 100', () => {
    render(<ProgressBar value={150} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('обрезает отрицательные значения до 0', () => {
    render(<ProgressBar value={-10} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('aria-valuemin=0, aria-valuemax=100 всегда', () => {
    render(<ProgressBar value={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('ширина заливки в процентах соответствует обрезанному value', () => {
    render(<ProgressBar value={65} />)
    const track = screen.getByRole('progressbar')
    const fill = track.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('65%')
  })
})

describe('ProgressBar — подпись', () => {
  it('без label не рендерит блок подписи и не проставляет aria-labelledby', () => {
    const { container } = render(<ProgressBar value={10} />)
    expect(container.querySelector('.ui-progress-bar__label')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-labelledby')
  })

  it('с label рендерит подпись и связывает через aria-labelledby', () => {
    render(<ProgressBar value={10} label="Импорт остатков: батч 2 из 5" />)
    const bar = screen.getByRole('progressbar')
    const labelledBy = bar.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    expect(document.getElementById(labelledBy ?? '')).toHaveTextContent('Импорт остатков: батч 2 из 5')
  })
})

describe('ProgressBar — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<ProgressBar value={55} label="Загрузка" />)
    expect(axeResults).toHaveNoViolations()
  })
})
