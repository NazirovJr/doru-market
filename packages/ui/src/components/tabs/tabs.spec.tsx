/**
 * `tabs.spec.tsx` (DTJ-408, тест-план тикета).
 */
import { type ReactElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBlockingViolations, renderWithA11yCheck } from '@/a11y/test-utils'
import { Tabs, type TabItem } from './tabs'

afterEach(() => {
  cleanup()
})

const TAB_ITEMS: readonly TabItem[] = [
  { id: 'relevance', label: 'По релевантности' },
  { id: 'price', label: 'По цене' },
  { id: 'distance', label: 'По расстоянию' },
]

const ControlledTabs = (): ReactElement => {
  const [activeId, setActiveId] = useState('relevance')
  return <Tabs tabs={TAB_ITEMS} activeId={activeId} onChange={setActiveId} aria-label="Сортировка результатов" />
}

describe('Tabs — роли и aria-selected', () => {
  it('рендерит role="tablist"/role="tab" и синхронизирует aria-selected с активным табом', () => {
    render(<ControlledTabs />)
    expect(screen.getByRole('tablist', { name: 'Сортировка результатов' })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'По релевантности' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'По цене' })).toHaveAttribute('aria-selected', 'false')
  })

  it('клик по табу меняет активный таб', () => {
    render(<ControlledTabs />)
    fireEvent.click(screen.getByRole('tab', { name: 'По цене' }))
    expect(screen.getByRole('tab', { name: 'По цене' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'По релевантности' })).toHaveAttribute('aria-selected', 'false')
  })
})

describe('Tabs — клавиатурная навигация стрелками', () => {
  it('ArrowRight переключает на следующий таб и переносит фокус', () => {
    render(<ControlledTabs />)
    const active = screen.getByRole('tab', { name: 'По релевантности' })
    active.focus()
    fireEvent.keyDown(active, { key: 'ArrowRight' })
    const next = screen.getByRole('tab', { name: 'По цене' })
    expect(next).toHaveAttribute('aria-selected', 'true')
    expect(next).toHaveFocus()
  })

  it('ArrowLeft на первом табе зацикливается на последний (roving tabIndex)', () => {
    render(<ControlledTabs />)
    const active = screen.getByRole('tab', { name: 'По релевантности' })
    active.focus()
    fireEvent.keyDown(active, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'По расстоянию' })).toHaveAttribute('aria-selected', 'true')
  })

  it('End выбирает последний таб, Home — первый', () => {
    render(<ControlledTabs />)
    const active = screen.getByRole('tab', { name: 'По релевантности' })
    active.focus()
    fireEvent.keyDown(active, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'По расстоянию' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'По расстоянию' }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'По релевантности' })).toHaveAttribute('aria-selected', 'true')
  })

  it('только активный таб в tab-order (roving tabIndex)', () => {
    render(<ControlledTabs />)
    expect(screen.getByRole('tab', { name: 'По релевантности' })).toHaveAttribute('tabIndex', '0')
    expect(screen.getByRole('tab', { name: 'По цене' })).toHaveAttribute('tabIndex', '-1')
  })
})

describe('Tabs — доступность', () => {
  it('нулевые critical/serious нарушения', async () => {
    const { axeResults } = await renderWithA11yCheck(<ControlledTabs />)
    assertNoBlockingViolations(axeResults)
  })
})
