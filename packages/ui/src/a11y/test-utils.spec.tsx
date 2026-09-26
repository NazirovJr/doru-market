/**
 * `test-utils.spec.tsx` (DTJ-403, критерий приёмки 3, тест-план — «самопроверочный тест»).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AUDITORS,
  FOCUS_INDICATOR_RULE_ID,
  type A11yCheckResult,
  assertNoBlockingViolations,
  axeAuditor,
  createAxeAuditor,
  createUnavailableAuditor,
  focusIndicatorAuditor,
  isBlocking,
  renderWithA11yCheck,
  runA11yAudit,
} from './test-utils'
import { BrokenFocusButton } from './__fixtures__/broken-focus-button'

const makeResult = (overrides: Partial<A11yCheckResult> = {}): A11yCheckResult => ({
  violations: [],
  blocking: [],
  warnings: [],
  unavailableAuditors: [],
  ...overrides,
})

describe('renderWithA11yCheck (AC3 — ловушка проверяется ловушкой)', () => {
  it('catches a component that suppresses its focus indicator without a box-shadow replacement', async () => {
    const { axeResults } = await renderWithA11yCheck(<BrokenFocusButton />)
    expect(axeResults.violations.length).toBeGreaterThan(0)
    expect(axeResults.blocking.some((violation) => violation.id === FOCUS_INDICATOR_RULE_ID)).toBe(true)
    expect(() => { assertNoBlockingViolations(axeResults) }).toThrow(/Нарушения доступности/)
  })

  it('reports axe-core as unavailable rather than silently reporting zero violations', async () => {
    const { axeResults } = await renderWithA11yCheck(<BrokenFocusButton />)
    expect(axeResults.unavailableAuditors).toContain('axe-core')
  })

  it('passes for a component with a visible focus indicator', async () => {
    const { axeResults } = await renderWithA11yCheck(
      <button type="button" style={{ boxShadow: '0 0 0 2px blue' }}>
        ok
      </button>,
    )
    expect(axeResults.blocking).toHaveLength(0)
    expect(() => { assertNoBlockingViolations(axeResults) }).not.toThrow()
  })
})

describe('focusIndicatorAuditor', () => {
  it('does not flag an element without explicit outline suppression', async () => {
    document.body.innerHTML = '<button id="b">b</button>'
    const violations = await focusIndicatorAuditor.run(document.body)
    expect(violations).toHaveLength(0)
    document.body.innerHTML = ''
  })

  it('accepts outline:none when compensated by box-shadow', async () => {
    document.body.innerHTML = '<button id="b" style="outline: none; box-shadow: 0 0 0 2px red;">b</button>'
    const violations = await focusIndicatorAuditor.run(document.body)
    expect(violations).toHaveLength(0)
    document.body.innerHTML = ''
  })

  it('flags outline-width: 0 without a box-shadow replacement', async () => {
    document.body.innerHTML = '<button id="b" style="outline-width: 0;">b</button>'
    const violations = await focusIndicatorAuditor.run(document.body)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.impact).toBe('serious')
    expect(violations[0]?.id).toBe(FOCUS_INDICATOR_RULE_ID)
    document.body.innerHTML = ''
  })
})

describe('isBlocking', () => {
  it('treats critical and serious as blocking', () => {
    expect(isBlocking({ id: 'x', impact: 'critical', description: '', help: '', helpUrl: '', nodes: [] })).toBe(true)
    expect(isBlocking({ id: 'x', impact: 'serious', description: '', help: '', helpUrl: '', nodes: [] })).toBe(true)
  })

  it('treats moderate/minor/null as warnings, not blocking', () => {
    expect(isBlocking({ id: 'x', impact: 'moderate', description: '', help: '', helpUrl: '', nodes: [] })).toBe(
      false,
    )
    expect(isBlocking({ id: 'x', impact: 'minor', description: '', help: '', helpUrl: '', nodes: [] })).toBe(false)
    expect(isBlocking({ id: 'x', impact: null, description: '', help: '', helpUrl: '', nodes: [] })).toBe(false)
  })
})

describe('createAxeAuditor / createUnavailableAuditor', () => {
  it('maps axe.run results into the package A11yViolation shape', async () => {
    const run = vi.fn().mockResolvedValue({
      violations: [
        {
          id: 'image-alt',
          impact: 'critical',
          description: 'desc',
          help: 'help',
          helpUrl: 'https://example.test',
          nodes: [{ target: ['img', ['.a', '.b']] }],
        },
      ],
    })
    const auditor = createAxeAuditor(run)
    expect(auditor.available).toBe(true)
    const violations = await auditor.run(document.body)
    expect(violations).toEqual([
      {
        id: 'image-alt',
        impact: 'critical',
        description: 'desc',
        help: 'help',
        helpUrl: 'https://example.test',
        nodes: ['img .a .b'],
      },
    ])
  })

  it('defaults a missing impact to null', async () => {
    const run = vi.fn().mockResolvedValue({
      violations: [{ id: 'x', description: 'd', help: 'h', helpUrl: 'u', nodes: [{ target: ['x'] }] }],
    })
    const violations = await createAxeAuditor(run).run(document.body)
    expect(violations[0]?.impact).toBeNull()
  })

  it('marks an unavailable auditor and rejects if run is invoked anyway', async () => {
    const unavailable = createUnavailableAuditor('example', 'not installed')
    expect(unavailable.available).toBe(false)
    await expect(unavailable.run(document.body)).rejects.toThrow(/example/)
  })
})

describe('axeAuditor (TODO(DTJ-403) placeholder)', () => {
  it('is registered as unavailable until axe-core is added as a dependency', () => {
    expect(axeAuditor.available).toBe(false)
    expect(axeAuditor.name).toBe('axe-core')
    expect(DEFAULT_AUDITORS).toContain(axeAuditor)
    expect(DEFAULT_AUDITORS).toContain(focusIndicatorAuditor)
  })
})

describe('runA11yAudit', () => {
  it('skips unavailable auditors and lists them separately from violations', async () => {
    const available = createAxeAuditor(() => Promise.resolve({ violations: [] }))
    const unavailable = createUnavailableAuditor('skipped', 'not installed')
    const result = await runA11yAudit(document.createElement('div'), [available, unavailable])
    expect(result.violations).toHaveLength(0)
    expect(result.unavailableAuditors).toEqual(['skipped'])
  })

  it('splits violations into blocking and warnings by impact', async () => {
    const auditor = {
      name: 'fixture',
      available: true,
      run: () =>
        Promise.resolve([
          { id: 'a', impact: 'critical' as const, description: '', help: '', helpUrl: '', nodes: [] },
          { id: 'b', impact: 'minor' as const, description: '', help: '', helpUrl: '', nodes: [] },
        ]),
    }
    const result = await runA11yAudit(document.createElement('div'), [auditor])
    expect(result.blocking).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
  })
})

describe('assertNoBlockingViolations', () => {
  it('does not throw when there are no blocking violations', () => {
    expect(() => { assertNoBlockingViolations(makeResult()) }).not.toThrow()
  })

  it('includes impact, id, help and node list in the thrown message', () => {
    const result = makeResult({
      blocking: [
        {
          id: 'dorutj-focus-indicator',
          impact: 'serious',
          description: 'd',
          help: 'Фокус обязан быть видим',
          helpUrl: 'https://example.test',
          nodes: ['<button>x</button>'],
        },
      ],
    })
    expect(() => { assertNoBlockingViolations(result) }).toThrow(/serious.*dorutj-focus-indicator.*Фокус обязан/s)
  })
})
