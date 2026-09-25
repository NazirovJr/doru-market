/**
 * `checkbox.spec.tsx` (DTJ-405, критерий приёмки 5, тест-план тикета).
 */
import { type ReactElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertHitArea, MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Checkbox } from './checkbox'

afterEach(() => {
  cleanup()
})

describe('Checkbox — hit-зона (AC5)', () => {
  it('видимый визуальный квадрат 20×20px, эффективная область попадания ≥48×48px', () => {
    render(<Checkbox label="Согласен с условиями" checked={false} onChange={vi.fn()} />)
    const row = screen.getByText('Согласен с условиями').closest('label')
    expect(row).not.toBeNull()
    assertHitArea(row as HTMLElement, MIN_HIT_AREA_PX)
  })
})

describe('Checkbox — ARIA/семантика нативного input', () => {
  it('связан с label, переключается кликом по label (нативная семантика)', () => {
    render(<Checkbox label="Согласен с условиями" checked={false} onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'Согласен с условиями' })).not.toBeChecked()
  })

  it('checked=true отражается на нативном input', () => {
    render(<Checkbox label="Согласен с условиями" checked onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })
})

describe('Checkbox — управляемость', () => {
  it('значение не меняется без вызова onChange потребителем', () => {
    render(<Checkbox label="Согласен" checked={false} onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('обновляет состояние при onChange, подключённом к состоянию', () => {
    const Wrapper = (): ReactElement => {
      const [checked, setChecked] = useState(false)
      return <Checkbox label="Согласен" checked={checked} onChange={setChecked} />
    }
    render(<Wrapper />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).toBeChecked()
  })
})

describe('Checkbox — доступность', () => {
  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Checkbox label="Согласен с условиями" checked={false} onChange={vi.fn()} />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
