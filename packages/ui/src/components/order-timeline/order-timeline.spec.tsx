import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { OrderTimeline, type OrderTimelineStep } from './order-timeline.js'

const steps: readonly OrderTimelineStep[] = [
  { id: 'created', status: 'Заказ создан', timestamp: '10:00', isCompleted: true, isCurrent: false },
  { id: 'confirmed', status: 'Подтверждён аптекой', timestamp: '10:05', isCompleted: true, isCurrent: false },
  { id: 'ready', status: 'Готов к выдаче', isCompleted: false, isCurrent: true },
  { id: 'picked_up', status: 'Выдан', isCompleted: false, isCurrent: false },
]

describe('OrderTimeline — рендерит шаги в переданном порядке (тест-план DTJ-407 п.7)', () => {
  it('4 шага рендерятся, порядок DOM совпадает с порядком массива', () => {
    render(<OrderTimeline steps={steps} />);
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Заказ создан'),
      expect.stringContaining('Подтверждён аптекой'),
      expect.stringContaining('Готов к выдаче'),
      expect.stringContaining('Выдан'),
    ])
  })

  it('каждый шаг — иконка + время + текст (когда время передано)', () => {
    render(<OrderTimeline steps={steps} />)
    expect(screen.getByText('Заказ создан')).toBeInTheDocument()
    expect(screen.getByText('10:00')).toBeInTheDocument()
    const firstStep = screen.getAllByRole('listitem')[0]
    expect(firstStep?.querySelector('svg')).toBeInTheDocument()
  })

  it('шаг без timestamp — текст времени не рендерится (не пустой параграф)', () => {
    render(<OrderTimeline steps={steps} />)
    const currentStep = screen.getByText('Готов к выдаче').closest('li')
    expect(currentStep?.querySelector('.ui-order-timeline__timestamp')).not.toBeInTheDocument()
  })
})

describe('OrderTimeline — isCurrent отличим не только цветом (форма маркера, тест-план DTJ-407 п.7)', () => {
  it('текущий шаг — квадратный маркер (rect в SVG), завершённые/будущие — круглый (circle)', () => {
    render(<OrderTimeline steps={steps} />)
    const items = screen.getAllByRole('listitem')

    expect(items[0]?.querySelector('svg circle')).toBeInTheDocument()
    expect(items[0]?.querySelector('svg rect')).not.toBeInTheDocument()

    expect(items[2]?.querySelector('svg rect')).toBeInTheDocument()
    expect(items[2]?.querySelector('svg circle')).not.toBeInTheDocument()

    expect(items[3]?.querySelector('svg circle')).toBeInTheDocument()
  })

  it('текущий шаг — aria-current="step" для доступности (не только визуальный признак)', () => {
    render(<OrderTimeline steps={steps} />)
    const currentItem = screen.getByText('Готов к выдаче').closest('li')
    expect(currentItem).toHaveAttribute('aria-current', 'step')
  })

  it('завершённый и ожидающий шаги — разные формы маркера между собой тоже (completed: закрашенный круг+галочка, pending: контурный круг)', () => {
    render(<OrderTimeline steps={steps} />)
    const items = screen.getAllByRole('listitem')
    const completedMarkerSvg = items[0]?.querySelector('svg')
    const pendingMarkerSvg = items[3]?.querySelector('svg')
    expect(completedMarkerSvg?.querySelector('path')).toBeInTheDocument()
    expect(pendingMarkerSvg?.querySelector('path')).not.toBeInTheDocument()
  })
})

describe('OrderTimeline — доступность', () => {
  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<OrderTimeline steps={steps} />)
    expect(axeResults).toHaveNoViolations()
  })
})
