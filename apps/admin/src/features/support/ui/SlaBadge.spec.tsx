/**
 * Component-тест `SlaBadge` (DTJ-283, тест-план: «SlaBadge — все 3 цветовых состояния»).
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SlaBadge } from './SlaBadge'

const NOW = Date.now()
const MINUTES = 60_000

describe('SlaBadge', () => {
  it('в пределах SLA (> 15 минут до дедлайна) → data-sla-state="ok"', () => {
    render(<SlaBadge firstResponseDueAt={new Date(NOW + 60 * MINUTES).toISOString()} firstRespondedAt={null} />)
    expect(screen.getByTestId('sla-badge')).toHaveAttribute('data-sla-state', 'ok')
  })

  it('< 15 минут до дедлайна → data-sla-state="warning"', () => {
    render(<SlaBadge firstResponseDueAt={new Date(NOW + 5 * MINUTES).toISOString()} firstRespondedAt={null} />)
    expect(screen.getByTestId('sla-badge')).toHaveAttribute('data-sla-state', 'warning')
  })

  it('дедлайн прошёл → data-sla-state="overdue"', () => {
    render(<SlaBadge firstResponseDueAt={new Date(NOW - 5 * MINUTES).toISOString()} firstRespondedAt={null} />)
    expect(screen.getByTestId('sla-badge')).toHaveAttribute('data-sla-state', 'overdue')
  })

  it('firstRespondedAt задан → data-sla-state="responded" (нейтрально, даже если дедлайн уже прошёл)', () => {
    render(<SlaBadge firstResponseDueAt={new Date(NOW - 5 * MINUTES).toISOString()} firstRespondedAt={new Date(NOW).toISOString()} />)
    expect(screen.getByTestId('sla-badge')).toHaveAttribute('data-sla-state', 'responded')
  })
})
