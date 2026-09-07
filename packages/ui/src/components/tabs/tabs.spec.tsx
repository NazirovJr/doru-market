import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Tabs, type TabItem } from './tabs.js'

const ITEMS: readonly TabItem[] = [
  { id: 'relevance', label: 'По релевантности' },
  { id: 'price_asc', label: 'Сначала дешевле' },
  { id: 'distance', label: 'Ближе всего' },
]

describe('Tabs — aria-selected синхронизирован с активным табом', () => {
  it('выставляет aria-selected="true" только на выбранную вкладку', () => {
    render(<Tabs items={ITEMS} value="price_asc" onChange={() => undefined} aria-label="Сортировка" />)

    expect(screen.getByRole('tab', { name: 'По релевантности' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Сначала дешевле' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Ближе всего' })).toHaveAttribute('aria-selected', 'false')
  })

  it('клик по вкладке вызывает onChange с её id', () => {
    const onChange = vi.fn()
    render(<Tabs items={ITEMS} value="relevance" onChange={onChange} aria-label="Сортировка" />)

    fireEvent.click(screen.getByRole('tab', { name: 'Ближе всего' }))
    expect(onChange).toHaveBeenCalledWith('distance')
  })
})

describe('Tabs — клавиатурная навигация стрелками', () => {
  it('ArrowRight с последней вкладки переходит на первую (по кругу)', () => {
    const ControlledTabs = (): ReturnType<typeof Tabs> => {
      const [value, setValue] = useState('distance')
      return <Tabs items={ITEMS} value={value} onChange={setValue} aria-label="Сортировка" />
    }
    render(<ControlledTabs />)

    const lastTab = screen.getByRole('tab', { name: 'Ближе всего' })
    lastTab.focus()
    fireEvent.keyDown(lastTab, { key: 'ArrowRight' })

    const firstTab = screen.getByRole('tab', { name: 'По релевантности' })
    expect(firstTab).toHaveAttribute('aria-selected', 'true')
    expect(firstTab).toHaveFocus()
  })

  it('ArrowLeft с первой вкладки переходит на последнюю (по кругу)', () => {
    const ControlledTabs = (): ReturnType<typeof Tabs> => {
      const [value, setValue] = useState('relevance')
      return <Tabs items={ITEMS} value={value} onChange={setValue} aria-label="Сортировка" />
    }
    render(<ControlledTabs />)

    const firstTab = screen.getByRole('tab', { name: 'По релевантности' })
    firstTab.focus()
    fireEvent.keyDown(firstTab, { key: 'ArrowLeft' })

    expect(screen.getByRole('tab', { name: 'Ближе всего' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Home/End переходят к первой/последней вкладке', () => {
    const ControlledTabs = (): ReturnType<typeof Tabs> => {
      const [value, setValue] = useState('price_asc')
      return <Tabs items={ITEMS} value={value} onChange={setValue} aria-label="Сортировка" />
    }
    render(<ControlledTabs />)

    const middleTab = screen.getByRole('tab', { name: 'Сначала дешевле' })
    middleTab.focus()
    fireEvent.keyDown(middleTab, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Ближе всего' })).toHaveAttribute('aria-selected', 'true')

    const lastTab = screen.getByRole('tab', { name: 'Ближе всего' })
    fireEvent.keyDown(lastTab, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'По релевантности' })).toHaveAttribute('aria-selected', 'true')
  })

  it('стрелки пропускают disabled-вкладку', () => {
    const itemsWithDisabled: readonly TabItem[] = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: true },
      { id: 'c', label: 'C' },
    ]
    const ControlledTabs = (): ReturnType<typeof Tabs> => {
      const [value, setValue] = useState('a')
      return <Tabs items={itemsWithDisabled} value={value} onChange={setValue} aria-label="Тест" />
    }
    render(<ControlledTabs />)

    const tabA = screen.getByRole('tab', { name: 'A' })
    tabA.focus()
    fireEvent.keyDown(tabA, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'C' })).toHaveAttribute('aria-selected', 'true')
  })

  it('нестрелочная клавиша не меняет выбор', () => {
    const onChange = vi.fn()
    render(<Tabs items={ITEMS} value="relevance" onChange={onChange} aria-label="Сортировка" />)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'По релевантности' }), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('стрелка при всех disabled-вкладках ничего не делает', () => {
    const allDisabled: readonly TabItem[] = [
      { id: 'a', label: 'A', disabled: true },
      { id: 'b', label: 'B', disabled: true },
    ]
    const onChange = vi.fn()
    render(<Tabs items={allDisabled} value="a" onChange={onChange} aria-label="Тест" />)

    fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('только выбранная вкладка в tab-order (roving tabIndex)', () => {
    render(<Tabs items={ITEMS} value="price_asc" onChange={() => undefined} aria-label="Сортировка" />)

    expect(screen.getByRole('tab', { name: 'По релевантности' })).toHaveAttribute('tabIndex', '-1')
    expect(screen.getByRole('tab', { name: 'Сначала дешевле' })).toHaveAttribute('tabIndex', '0')
  })
})

describe('Tabs — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <Tabs items={ITEMS} value="relevance" onChange={() => undefined} aria-label="Сортировка" />,
    )
    expect(axeResults).toHaveNoViolations()
  })
})
