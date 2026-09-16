/**
 * `ReturnStatusTimeline.spec.tsx` (DTJ-276) — АС4: `return_rejected` показывает «отклонён» БЕЗ
 * пометки «завершено» (визуально отличается от терминального `return_confirmed`).
 */
import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { ReturnStatus } from '@dorutj/contracts'
import { ReturnStatusTimeline } from './ReturnStatusTimeline'
import { renderWithProviders } from './test-utils'

function renderTimeline(status: ReturnStatus) {
  return renderWithProviders(<ReturnStatusTimeline orderReturn={{ status }} />)
}

describe('ReturnStatusTimeline (DTJ-276)', () => {
  it('return_requested — только первый шаг пройден', () => {
    renderTimeline('return_requested')
    const steps = screen.getAllByTestId('return-timeline-step')
    expect(steps).toHaveLength(3)
    expect(steps[0]).toHaveAttribute('data-done', 'true')
    expect(steps[1]).toHaveAttribute('data-done', 'false')
    expect(steps[2]).toHaveAttribute('data-done', 'false')
    expect(screen.queryByTestId('return-timeline-rejected')).not.toBeInTheDocument()
  })

  it('returned_to_pharmacy (недостижим в R1, D-EP11-4) — защитный путь трактуется как return_in_transit', () => {
    renderTimeline('returned_to_pharmacy')
    const steps = screen.getAllByTestId('return-timeline-step')
    expect(steps[0]).toHaveAttribute('data-done', 'true')
    expect(steps[1]).toHaveAttribute('data-done', 'true')
    expect(steps[2]).toHaveAttribute('data-done', 'false')
  })

  it('return_in_transit — первые два шага пройдены', () => {
    renderTimeline('return_in_transit')
    const steps = screen.getAllByTestId('return-timeline-step')
    expect(steps[0]).toHaveAttribute('data-done', 'true')
    expect(steps[1]).toHaveAttribute('data-done', 'true')
    expect(steps[2]).toHaveAttribute('data-done', 'false')
  })

  it('return_confirmed — терминальный статус, ВСЕ шаги помечены завершёнными', () => {
    renderTimeline('return_confirmed')
    const steps = screen.getAllByTestId('return-timeline-step')
    expect(steps).toHaveLength(3)
    for (const step of steps) {
      expect(step).toHaveAttribute('data-done', 'true')
    }
    expect(screen.queryByTestId('return-timeline-rejected')).not.toBeInTheDocument()
  })

  it('АС4: return_rejected — показывает «отклонён» отдельной строкой, БЕЗ финального шага «завершено»', () => {
    renderTimeline('return_rejected')
    const steps = screen.getAllByTestId('return-timeline-step')
    // Только 2 обычных шага (requested/in_transit) — return_confirmed не рендерится как «завершён».
    expect(steps).toHaveLength(2)
    expect(steps[0]).toHaveAttribute('data-done', 'true')
    expect(steps[1]).toHaveAttribute('data-done', 'true')
    const rejectedRow = screen.getByTestId('return-timeline-rejected')
    expect(rejectedRow).toHaveClass('text-brand-danger')
    expect(rejectedRow.textContent).not.toBe('')
  })
})
