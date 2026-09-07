import { render, type RenderResult } from '@testing-library/react'
import axe from 'axe-core'
import type { ReactElement } from 'react'
import { expect } from 'vitest'

type AxeResults = axe.AxeResults
type AxeViolation = axe.Result

/** Уровни `axe-core`, которые блокируют CI (согласовано с `SRS-UX-035` для E2E-уровня — здесь
 * применяется по аналогии к unit-уровню): `critical`/`serious` — ноль нарушений, `moderate`/
 * `minor` — предупреждение, не блокирует. */
const BLOCKING_IMPACT_LEVELS: ReadonlySet<string> = new Set(['critical', 'serious'])

export interface A11yCheckResult {
  readonly container: RenderResult['container']
  readonly axeResults: AxeResults
}

/**
 * ВТОРОЙ, независимый от Storybook `@storybook/addon-a11y` (DTJ-400), канал проверки
 * доступности: рендерит `ui` через `@testing-library/react` и синхронно (в рамках `await`)
 * прогоняет `axe-core` — без поднятия Storybook, быстрее в CI, часть `pnpm test`.
 *
 * Подключается одной строкой импорта в любом будущем `*.spec.tsx` `packages/ui` — сам импорт
 * этого модуля уже регистрирует кастомный матчер `toHaveNoViolations` (см. `expect.extend` ниже),
 * дополнительно ставить не нужно.
 *
 * ОГРАНИЧЕНИЕ (см. также `tickets/.../DTJ-403.md` «Риски и подводные камни»): `axe-core` под
 * `jsdom` НЕ проверяет реальный computed contrast так же надёжно, как настоящий браузер — `jsdom`
 * не выполняет полноценный layout/paint. Контрастные нарушения текста (`SRS-UX-003`) на этом
 * уровне могут быть ложноотрицательными. Этот прогон ловит СТРУКТУРНЫЕ нарушения (`aria-*`,
 * `role`, порядок табуляции, отсутствие `alt`), не пиксельный контраст — финальная сеть для
 * контраста: `@axe-core/playwright` в реальном браузере на E2E-уровне (DTJ-417/418+). Будущим
 * разработчикам: зелёный unit-прогон axe НЕ означает «контраст проверен».
 */
export async function renderWithA11yCheck(ui: ReactElement): Promise<A11yCheckResult> {
  const { container } = render(ui)
  const axeResults = await axe.run(container)
  return { container, axeResults }
}

/** `moderate`/`minor` нарушения — для отчётов/предупреждений, не блокируют `toHaveNoViolations`. */
export function getBlockingViolations(axeResults: AxeResults): AxeViolation[] {
  return axeResults.violations.filter((violation) => BLOCKING_IMPACT_LEVELS.has(violation.impact ?? ''))
}

interface CustomMatchers<R = unknown> {
  toHaveNoViolations: () => R
}

declare module 'vitest' {
  // Дефолт типового параметра обязан дословно совпадать с `Assertion<T = any>` из
  // `@vitest/expect`, иначе слияние деклараций падает с TS2428 (несовпадающие дефолты одного и
  // того же generic-параметра интерфейса) — литерал `any` здесь не выбор, а требование слияния.
  // Пустое тело `extends CustomMatchers<T>` — стандартный паттерн расширения матчеров из
  // документации Vitest, а не забытая реализация.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type -- см. пояснение выше
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- тот же паттерн расширения матчеров, см. пояснение выше
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toHaveNoViolations(received: AxeResults) {
    const blocking = getBlockingViolations(received)
    return {
      pass: blocking.length === 0,
      message: () => formatViolationsMessage(blocking),
    }
  },
})

function formatViolationsMessage(blocking: AxeViolation[]): string {
  if (blocking.length === 0) {
    return 'Expected axe violations (critical/serious), but found none.'
  }
  // `blocking` уже отфильтрован `getBlockingViolations` до только `critical`/`serious` — `impact`
  // здесь никогда не `null`, фолбэк не нужен (в отличие от фильтра выше, где `null` возможен).
  const summary = blocking
    .map((violation) => `- [${String(violation.impact)}] ${violation.id}: ${violation.help}`)
    .join('\n')
  return `Found ${String(blocking.length)} blocking accessibility violation(s) (critical/serious):\n${summary}`
}
