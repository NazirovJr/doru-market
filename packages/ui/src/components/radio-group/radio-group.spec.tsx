/**
 * `radio-group.spec.tsx` (DTJ-405, тест-план тикета: assertHitArea/ARIA/управляемость).
 */
import { type ReactElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertHitArea, MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { RadioGroup, type RadioOption } from './radio-group'

afterEach(() => {
  cleanup()
})

const OPTIONS: readonly RadioOption[] = [
  { value: 'card', label: 'Картой' },
  { value: 'cash', label: 'Наличными' },
]

describe('RadioGroup — ARIA и hit-зона', () => {
  it('role="radiogroup" на контейнере, каждая строка ≥48×48px', () => {
    render(<RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value="card" onChange={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'Способ оплаты' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    for (const radio of radios) {
      const row = radio.closest('label')
      expect(row).not.toBeNull()
      assertHitArea(row as HTMLElement, MIN_HIT_AREA_PX)
    }
  })

  it('текущее значение отмечено checked на нативном input', () => {
    render(<RadioGroup name="payment" options={OPTIONS} value="cash" onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: 'Наличными' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Картой' })).not.toBeChecked()
  })
})

describe('RadioGroup — управляемость', () => {
  it('значение не меняется без вызова onChange потребителем', () => {
    render(<RadioGroup name="payment" options={OPTIONS} value="card" onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Наличными' }))
    expect(screen.getByRole('radio', { name: 'Картой' })).toBeChecked()
  })

  it('обновляет выбор при onChange, подключённом к состоянию', () => {
    const Wrapper = (): ReactElement => {
      const [value, setValue] = useState('card')
      return <RadioGroup name="payment" options={OPTIONS} value={value} onChange={setValue} />
    }
    render(<Wrapper />)
    fireEvent.click(screen.getByRole('radio', { name: 'Наличными' }))
    expect(screen.getByRole('radio', { name: 'Наличными' })).toBeChecked()
  })
})

describe('RadioGroup — доступность', () => {
  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <RadioGroup name="payment" label="Способ оплаты" options={OPTIONS} value="card" onChange={vi.fn()} />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
