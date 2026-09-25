/**
 * `renderWithA11yCheck` (DTJ-403, SRS-UX-034, SRS-UX-035) — второй, независимый от Storybook
 * канал автопроверки доступности: рендерит компонент через `@testing-library/react` и
 * прогоняет по отрендеренному DOM набор аудиторов. Подключение из любого `*.spec.tsx` пакета:
 *
 * ```ts
 * import { renderWithA11yCheck, assertNoBlockingViolations } from '@/a11y/test-utils'
 * const { axeResults } = await renderWithA11yCheck(<Button>…</Button>)
 * assertNoBlockingViolations(axeResults)
 * ```
 *
 * ПОРОГ (по аналогии с E2E-порогом SRS-UX-035, применённым к unit-уровню):
 * - нарушения `critical`/`serious` — ноль; `assertNoBlockingViolations` падает на них;
 * - `moderate`/`minor` — предупреждение (`axeResults.warnings`), CI не блокируют.
 *
 * АУДИТОРЫ:
 * - `focusIndicatorAuditor` — собственное правило пакета (WCAG 2.4.7, SRS-UX-019 «focus ВСЕГДА
 *   видим»): интерактивный элемент, у которого в фокусе явно подавлен `outline` без замены
 *   через `box-shadow`. Нужно ОТДЕЛЬНО от axe: в axe-core нет автоматического правила на
 *   видимость фокус-индикатора, он такие нарушения не ловит.
 * - `axeAuditor` — axe-core. ПОКА НЕ ПОДКЛЮЧЁН: пакета нет в зависимостях `@dorutj/ui`
 *   (см. TODO ниже). Пока он недоступен, его имя попадает в `axeResults.unavailableAuditors` —
 *   отсутствие проверки видно в результате, а не маскируется «нулём нарушений».
 *
 * ОГРАНИЧЕНИЕ unit-уровня: под `jsdom` CSS не рендерится полностью, поэтому контраст текста
 * (SRS-UX-003) здесь НЕ проверяется надёжно — возможны ложно-отрицательные результаты. Unit-прогон
 * ловит структурные нарушения (`aria-*`, `role`, имя, `alt`, подавленный фокус). Финальная сеть
 * контрастных проверок — `@axe-core/playwright` в реальном браузере на E2E-уровне (DTJ-417/418+).
 * Unit-прогона НЕДОСТАТОЧНО для требований контраста.
 */
import { type ReactElement } from 'react'
import { render } from '@testing-library/react'
import { getFocusableElements } from './use-focus-trap'

export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical'

export interface A11yViolation {
  readonly id: string
  readonly impact: A11yImpact | null
  readonly description: string
  readonly help: string
  readonly helpUrl: string
  /** CSS-селекторы или HTML-фрагменты узлов-нарушителей. */
  readonly nodes: readonly string[]
}

export interface A11yAuditor {
  readonly name: string
  readonly available: boolean
  readonly run: (container: HTMLElement) => Promise<readonly A11yViolation[]>
}

export interface A11yCheckResult {
  readonly violations: readonly A11yViolation[]
  /** `critical`/`serious` — блокируют (ноль допустимых). */
  readonly blocking: readonly A11yViolation[]
  /** `moderate`/`minor`/без уровня — предупреждение, CI не блокируют. */
  readonly warnings: readonly A11yViolation[]
  /** Аудиторы, которые не удалось выполнить (например, не установлен пакет). */
  readonly unavailableAuditors: readonly string[]
}

const BLOCKING_IMPACTS: ReadonlySet<A11yImpact> = new Set<A11yImpact>(['critical', 'serious'])

export const isBlocking = (violation: A11yViolation): boolean =>
  violation.impact !== null && BLOCKING_IMPACTS.has(violation.impact)

/* ---------------- Собственное правило: видимый фокус ---------------- */

export const FOCUS_INDICATOR_RULE_ID = 'dorutj-focus-indicator'

const isZeroPx = (value: string): boolean => Number.parseFloat(value) === 0

const isOutlineSuppressed = (style: CSSStyleDeclaration): boolean =>
  style.outlineStyle === 'none' || style.outlineStyle === 'hidden' || isZeroPx(style.outlineWidth)

const hasShadowReplacement = (style: CSSStyleDeclaration): boolean =>
  style.boxShadow !== '' && style.boxShadow !== 'none'

const hasSuppressedFocusIndicator = (element: HTMLElement): boolean => {
  element.focus()
  const style = getComputedStyle(element)
  const suppressed = isOutlineSuppressed(style) && !hasShadowReplacement(style)
  element.blur()
  return suppressed
}

/**
 * Ловит ЯВНОЕ подавление фокус-индикатора (`outline: none`/`0` без `box-shadow`-замены) у
 * элементов tab-порядка. Элемент без собственных стилей не считается нарушителем: под `jsdom`
 * нет UA-стилей, а браузерный индикатор по умолчанию видим.
 */
export const focusIndicatorAuditor: A11yAuditor = {
  name: FOCUS_INDICATOR_RULE_ID,
  available: true,
  run: (container) => {
    const offenders = getFocusableElements(container).filter(hasSuppressedFocusIndicator)
    if (offenders.length === 0) {
      return Promise.resolve([])
    }
    return Promise.resolve([
      {
        id: FOCUS_INDICATOR_RULE_ID,
        impact: 'serious',
        description: 'Интерактивный элемент подавляет фокус-индикатор без видимой замены.',
        help: 'Фокус обязан быть видим (WCAG 2.4.7, SRS-UX-019): используйте --focus-ring.',
        helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/focus-visible.html',
        nodes: offenders.map((element) => element.outerHTML),
      },
    ])
  },
}

/* ---------------- Порт axe-core ---------------- */

/** Структурное подмножество `axe.AxeResults` — ровно то, что читает адаптер. */
export interface AxeLikeResults {
  readonly violations: readonly {
    readonly id: string
    readonly impact?: A11yImpact | null
    readonly description: string
    readonly help: string
    readonly helpUrl: string
    readonly nodes: readonly { readonly target: readonly (string | readonly string[])[] }[]
  }[]
}

export type AxeRun = (context: HTMLElement) => Promise<AxeLikeResults>

const formatTarget = (target: readonly (string | readonly string[])[]): string =>
  target.map((part) => (typeof part === 'string' ? part : part.join(' '))).join(' ')

/** Адаптер `axe.run` → `A11yAuditor`. Принимает функцию, чтобы не импортировать axe-core здесь. */
export const createAxeAuditor = (run: AxeRun): A11yAuditor => ({
  name: 'axe-core',
  available: true,
  run: async (container) => {
    const results = await run(container)
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => formatTarget(node.target)),
    }))
  },
})

/** Аудитор-заглушка для проверки, которую нельзя выполнить: помечается как недоступная. */
export const createUnavailableAuditor = (name: string, reason: string): A11yAuditor => ({
  name,
  available: false,
  run: () => Promise.reject(new Error(`Аудитор ${name} недоступен: ${reason}`)),
})

// TODO(DTJ-403): axe-core не объявлен в зависимостях @dorutj/ui (есть только транзитивно через
// @storybook/addon-a11y, импортировать его отсюда нельзя). После добавления devDependency
// `axe-core` заменить строку ниже на:
//   export const axeAuditor = createAxeAuditor((context) => axe.run(context))  // import axe from 'axe-core'
export const axeAuditor: A11yAuditor = createUnavailableAuditor(
  'axe-core',
  'пакет axe-core не установлен в @dorutj/ui (DTJ-403, НУЖНЫЕ ЗАВИСИМОСТИ)',
)

export const DEFAULT_AUDITORS: readonly A11yAuditor[] = [focusIndicatorAuditor, axeAuditor]

/* ---------------- Прогон ---------------- */

export const runA11yAudit = async (
  container: HTMLElement,
  auditors: readonly A11yAuditor[] = DEFAULT_AUDITORS,
): Promise<A11yCheckResult> => {
  const available = auditors.filter((auditor) => auditor.available)
  const perAuditor = await Promise.all(available.map((auditor) => auditor.run(container)))
  const violations = perAuditor.flat()
  return {
    violations,
    blocking: violations.filter(isBlocking),
    warnings: violations.filter((violation) => !isBlocking(violation)),
    unavailableAuditors: auditors.filter((auditor) => !auditor.available).map((auditor) => auditor.name),
  }
}

export interface RenderWithA11yCheckResult {
  readonly container: HTMLElement
  readonly axeResults: A11yCheckResult
}

export const renderWithA11yCheck = async (
  ui: ReactElement,
  auditors: readonly A11yAuditor[] = DEFAULT_AUDITORS,
): Promise<RenderWithA11yCheckResult> => {
  const { container } = render(ui)
  const axeResults = await runA11yAudit(container, auditors)
  return { container, axeResults }
}

const formatViolation = (violation: A11yViolation): string =>
  `- [${violation.impact ?? 'n/a'}] ${violation.id}: ${violation.help}\n    ${violation.nodes.join('\n    ')}`

/** Падает, если есть нарушения уровня `critical`/`serious` (порог SRS-UX-035). */
export const assertNoBlockingViolations = (result: A11yCheckResult): void => {
  if (result.blocking.length === 0) {
    return
  }
  throw new Error(
    `Нарушения доступности уровня critical/serious (${String(result.blocking.length)}):\n` +
      result.blocking.map(formatViolation).join('\n'),
  )
}
