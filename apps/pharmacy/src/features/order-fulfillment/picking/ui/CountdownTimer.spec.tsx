import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CountdownTimer } from './CountdownTimer'

describe('<CountdownTimer /> (временная локальная реализация, TODO(DTJ-400))', () => {
  afterEach(() => { vi.useRealTimers() })

  it('deadlineAt=null — ничего не рендерит (SLA ещё не выставлен)', () => {
    render(<CountdownTimer deadlineAt={null} />)
    expect(screen.queryByTestId('picking-sla-timer')).not.toBeInTheDocument()
  })

  it('далеко от дедлайна — нейтральный вид, БЕЗ data-nearing-breach', () => {
    const deadlineAt = new Date(Date.now() + 5 * 60_000).toISOString()
    render(<CountdownTimer deadlineAt={deadlineAt} />)
    expect(screen.getByTestId('picking-sla-timer')).toHaveAttribute('data-nearing-breach', 'false')
  })

  it('≤120с до дедлайна — предупреждающий вид (data-nearing-breach=true)', () => {
    const deadlineAt = new Date(Date.now() + 60_000).toISOString()
    render(<CountdownTimer deadlineAt={deadlineAt} />)
    expect(screen.getByTestId('picking-sla-timer')).toHaveAttribute('data-nearing-breach', 'true')
  })

  it('дедлайн уже прошёл — показывает 0:00, не уходит в отрицательные значения', () => {
    const deadlineAt = new Date(Date.now() - 60_000).toISOString()
    render(<CountdownTimer deadlineAt={deadlineAt} />)
    expect(screen.getByTestId('picking-sla-timer')).toHaveTextContent('0:00')
  })
})
