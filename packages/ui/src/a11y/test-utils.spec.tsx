import type axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { BrokenFocusButton } from './__fixtures__/broken-focus-button'
import { getBlockingViolations, renderWithA11yCheck } from './test-utils'

describe('renderWithA11yCheck', () => {
  it('catches a real structural a11y violation (icon-only button without accessible name)', async () => {
    const { axeResults } = await renderWithA11yCheck(<BrokenFocusButton />)

    expect(axeResults).not.toHaveNoViolations()
    expect(axeResults.violations.some((violation) => violation.id === 'button-name')).toBe(true)
  })

  it('passes for a minimal accessible component (one-line import proves the utility is wired)', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <button type="button" aria-label="Закрыть">
        <span aria-hidden="true">×</span>
      </button>,
    )

    expect(axeResults).toHaveNoViolations()
  })
})

type FakeViolation = Pick<axe.Result, 'id' | 'impact' | 'help'>

function buildAxeResults(violations: FakeViolation[]): axe.AxeResults {
  return { violations } as unknown as axe.AxeResults
}

describe('getBlockingViolations / toHaveNoViolations matcher', () => {
  it('keeps only critical/serious, drops moderate/minor and null-impact entries', () => {
    const results = buildAxeResults([
      { id: 'button-name', impact: 'critical', help: 'a' },
      { id: 'color-contrast', impact: 'moderate', help: 'b' },
      { id: 'landmark-one-main', impact: 'minor', help: 'c' },
      { id: 'unscored-check', impact: null, help: 'd' },
    ])

    expect(getBlockingViolations(results).map((violation) => violation.id)).toEqual(['button-name'])
  })

  it('fails with a readable message listing blocking violations', () => {
    const results = buildAxeResults([
      { id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text' },
    ])

    expect(() => {
      expect(results).toHaveNoViolations()
    }).toThrow(/Found 1 blocking accessibility violation\(s\).*button-name/s)
  })

  it('reports a readable message when asserting the presence of violations that are not there', () => {
    const results = buildAxeResults([])

    expect(() => {
      expect(results).not.toHaveNoViolations()
    }).toThrow(/Expected axe violations \(critical\/serious\), but found none\./)
  })

  it('ignores moderate/minor violations (warning-only, non-blocking)', () => {
    const results = buildAxeResults([{ id: 'color-contrast', impact: 'moderate', help: 'n/a' }])

    expect(results).toHaveNoViolations()
  })
})
