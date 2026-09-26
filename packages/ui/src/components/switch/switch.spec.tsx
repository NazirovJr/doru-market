/**
 * `switch.spec.tsx` (DTJ-405, тест-план тикета: assertHitArea/ARIA/управляемость/reduced-motion).
 */
import { type ReactElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertHitArea, MIN_HIT_AREA_PX } from '@/a11y/assert-hit-area'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Switch } from './switch'

afterEach(() => {
  cleanup()
})

describe('Switch — ARIA', () => {
  it('role="switch" и aria-checked отражают состояние', () => {
    render(<Switch label="Уведомления" checked onChange={vi.fn()} />)
    const control = screen.getByRole('switch', { name: 'Уведомления' })
    expect(control).toHaveAttribute('aria-checked', 'true')
  })

  it('aria-checked="false" в выключенном состоянии', () => {
    render(<Switch label="Уведомления" checked={false} onChange={vi.fn()} />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Switch — hit-зона', () => {
  it('эффективная область попадания ≥48×48px', () => {
    render(<Switch label="Уведомления" checked={false} onChange={vi.fn()} />)
    const row = screen.getByText('Уведомления').closest('label')
    expect(row).not.toBeNull()
    assertHitArea(row as HTMLElement, MIN_HIT_AREA_PX)
  })
})

describe('Switch — управляемость', () => {
  it('значение не меняется без вызова onChange потребителем', () => {
    render(<Switch label="Уведомления" checked={false} onChange={() => undefined} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('обновляет состояние при onChange, подключённом к состоянию', () => {
    const Wrapper = (): ReactElement => {
      const [checked, setChecked] = useState(false)
      return <Switch label="Уведомления" checked={checked} onChange={setChecked} />
    }
    render(<Wrapper />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Switch — доступность', () => {
  it('нулевые critical/serious нарушения доступности', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Switch label="Уведомления" checked={false} onChange={vi.fn()} />,
    )
    assertNoBlockingViolations(axeResults)
  })
})
