/**
 * `progress-bar.spec.tsx` (DTJ-406, тест-план тикета — «SRS-UX-021 таблица», значения 0–100%).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { useT } from '@dorutj/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { ProgressBar } from './progress-bar'

afterEach(() => {
  cleanup()
})

const { t } = useT('ru')

describe('ProgressBar — value 0–100%', () => {
  it('выставляет aria-valuenow/min/max по value', () => {
    render(<ProgressBar value={42} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('обрезает значение ниже 0 до 0', () => {
    render(<ProgressBar value={-10} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('обрезает значение выше 100 до 100', () => {
    render(<ProgressBar value={150} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })
})

describe('ProgressBar — подпись (label/labelKey)', () => {
  it('не рендерит подпись, если ни label, ни labelKey не заданы', () => {
    render(<ProgressBar value={10} />)
    expect(screen.queryByText('10%')).not.toBeInTheDocument()
  })

  it('рендерит свободный текст label (как Input.label)', () => {
    render(<ProgressBar value={10} label="Загрузка отчёта" />)
    expect(screen.getByText('Загрузка отчёта')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('рендерит labelKey через переданный t()', () => {
    render(<ProgressBar value={10} labelKey="ux.action.retry" t={t} />)
    expect(screen.getByText(t('ux.action.retry'))).toBeInTheDocument()
  })

  it('labelKey без t не переводится (не рендерит подпись)', () => {
    render(<ProgressBar value={10} labelKey="ux.action.retry" />)
    expect(screen.queryByText(t('ux.action.retry'))).not.toBeInTheDocument()
  })
})

describe('ProgressBar — доступность', () => {
  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(<ProgressBar value={55} label="Импорт" />)
    assertNoBlockingViolations(axeResults)
  })
})
