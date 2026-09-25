/**
 * `order-timeline.spec.tsx` (DTJ-407, тест-план тикета).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OrderTimeline, type OrderTimelineStep } from './order-timeline'

afterEach(() => {
  cleanup()
})

const STEPS: readonly OrderTimelineStep[] = [
  { status: 'confirmed', label: 'Подтверждён', timestamp: new Date(2026, 0, 10, 9, 0), isCompleted: true, isCurrent: false },
  { status: 'processing', label: 'Собирается', timestamp: new Date(2026, 0, 10, 9, 15), isCompleted: false, isCurrent: true },
  { status: 'delivered', label: 'Доставлен', timestamp: null, isCompleted: false, isCurrent: false },
]

describe('OrderTimeline — порядок шагов и текущий шаг (тест-план DTJ-407)', () => {
  it('рендерит шаги в переданном порядке', () => {
    render(<OrderTimeline steps={STEPS} />)
    const rows = screen.getAllByTestId('order-timeline-step')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Подтверждён')
    expect(rows[1]).toHaveTextContent('Собирается')
    expect(rows[2]).toHaveTextContent('Доставлен')
  })

  it('помечает isCurrent-шаг aria-current="step"', () => {
    render(<OrderTimeline steps={STEPS} />)
    const rows = screen.getAllByTestId('order-timeline-step')
    expect(rows[1]).toHaveAttribute('aria-current', 'step')
    expect(rows[0]).not.toHaveAttribute('aria-current')
    expect(rows[2]).not.toHaveAttribute('aria-current')
  })

  it('isCurrent-шаг визуально отличим ФОРМОЙ маркера (ромб), не только цветом', () => {
    render(<OrderTimeline steps={STEPS} />)
    expect(screen.getByTestId('order-timeline-marker-current')).toBeInTheDocument()
    expect(screen.getByTestId('order-timeline-marker-completed')).toBeInTheDocument()
    expect(screen.getByTestId('order-timeline-marker-upcoming')).toBeInTheDocument()
  })

  it('рендерит отформатированное время для шага с timestamp и ничего для шага без него', () => {
    render(<OrderTimeline steps={STEPS} />)
    const times = screen.getAllByTestId('order-timeline-step-time')
    expect(times).toHaveLength(2)
    expect(times[0]).toHaveTextContent('10.01.2026 09:00')
  })

  it('рендерит пустой список без ошибок', () => {
    render(<OrderTimeline steps={[]} />)
    expect(screen.queryAllByTestId('order-timeline-step')).toHaveLength(0)
  })
})
