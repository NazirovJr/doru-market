/**
 * `runAxeCheck` (DTJ-417, `SRS-UX-035`) — единая точка подключения проверки доступности для
 * КАЖДОГО E2E CUJ-сценария (DTJ-418..423): вызывается на финальном состоянии экрана, порог
 * нарушений меняется в ОДНОМ месте (здесь), а не в каждом тесте.
 *
 * Порог зеркалит unit-уровень (`packages/ui/src/a11y/test-utils.ts`, DTJ-403, §«ПОРОГ»): ноль
 * нарушений `critical`/`serious`, `moderate`/`minor` — не блокируют.
 *
 * TODO(DTJ-417): `@axe-core/playwright` НЕ объявлен в зависимостях `tests/e2e` (отсутствует в
 * `pnpm-lock.yaml` на момент этого тикета — `grep -n "@axe-core/playwright" pnpm-lock.yaml`
 * пусто; голый CDN-скрипт тоже не вариант — `cdnjs.cloudflare.com` недоступен из egress-
 * политики окружения этого тикета, живым прогоном подтверждено `curl` → `403` через прокси
 * агента; ставить новую зависимость внутри тикета реализации запрещено, AGENTS.md §10).
 * До появления `@axe-core/playwright` в `tests/e2e/package.json` (см. НУЖНЫЕ ЗАВИСИМОСТИ отчёта
 * сдачи этого тикета) ниже — МИНИМАЛЬНЫЙ, полностью офлайновый набор правил (без axe-core,
 * без сети), тот же архитектурный приём, что `focusIndicatorAuditor` в `packages/ui/src/a11y/
 * test-utils.ts`: реальная, не всегда-зелёная проверка, а не заглушка. Покрывает подмножество
 * `SRS-UX-035`, достаточное для критерия приёмки этого тикета №4 (иконка-кнопка без `aria-
 * label`) — ПОЛНЫЙ набор правил axe-core (контраст, ARIA-семантика и т.д.) появится только
 * после подключения реального `@axe-core/playwright`, заменить `evaluateAxeLikeViolations`
 * ниже на:
 *
 * ```ts
 * import AxeBuilder from '@axe-core/playwright'
 * const results = await new AxeBuilder({ page }).analyze()
 * ```
 */
import { type Page } from '@playwright/test'

export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical'

export interface AxeViolation {
  readonly id: string
  readonly impact: A11yImpact | null
  readonly help: string
  readonly nodes: readonly string[]
}

const BLOCKING_IMPACTS: ReadonlySet<A11yImpact> = new Set<A11yImpact>(['critical', 'serious'])

/**
 * Прогоняет офлайновый минимальный набор правил на текущем состоянии `page` и падает, если
 * найдено ≥1 нарушение уровня `critical`/`serious` (`SRS-UX-035`). Сообщение об ошибке включает
 * описание каждого нарушения (критерий приёмки DTJ-417 №4).
 */
export async function runAxeCheck(page: Page): Promise<void> {
  const violations = await page.evaluate(evaluateAxeLikeViolations)
  const blocking = violations.filter(
    (violation) => violation.impact !== null && BLOCKING_IMPACTS.has(violation.impact),
  )
  if (blocking.length > 0) {
    throw new Error(formatBlockingViolations(blocking))
  }
}

/**
 * Выполняется В БРАУЗЕРЕ (`page.evaluate` сериализует ТОЛЬКО тело этой функции, не остальной
 * модуль) — `hasAccessibleName` поэтому объявлена ВНУТРИ, а не рядом на верхнем уровне файла:
 * ссылка на внешнюю функцию модуля обернулась бы в браузере в `ReferenceError` (подтверждено
 * живым прогоном self-check при первой версии этого файла).
 */
function evaluateAxeLikeViolations(): AxeViolation[] {
  const hasAccessibleName = (element: HTMLElement): boolean => {
    if (element.getAttribute('aria-label')?.trim()) return true
    if (element.getAttribute('aria-labelledby')?.trim()) return true
    if (element.textContent.trim()) return true
    if (element.querySelector('img[alt]:not([alt=""])')) return true
    if (element.getAttribute('title')?.trim()) return true
    return false
  }

  const violations: AxeViolation[] = []

  const interactiveSelector = 'button, [role="button"], a[href], [role="link"]'
  const interactiveOffenders = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter(
    (element) => !hasAccessibleName(element),
  )
  if (interactiveOffenders.length > 0) {
    violations.push({
      id: 'button-name',
      impact: 'serious',
      help:
        'Интерактивный элемент (кнопка/ссылка) обязан иметь доступное имя: видимый текст, ' +
        'aria-label или aria-labelledby (WCAG 4.1.2, SRS-UX-035).',
      nodes: interactiveOffenders.map((element) => element.outerHTML),
    })
  }

  const imageOffenders = Array.from(document.querySelectorAll<HTMLImageElement>('img')).filter(
    (img) => !img.hasAttribute('alt'),
  )
  if (imageOffenders.length > 0) {
    violations.push({
      id: 'image-alt',
      impact: 'critical',
      help: 'Изображение обязано иметь атрибут alt (WCAG 1.1.1, SRS-UX-035).',
      nodes: imageOffenders.map((img) => img.outerHTML),
    })
  }

  return violations
}

function formatBlockingViolations(blocking: readonly AxeViolation[]): string {
  const lines = blocking.map(
    (violation) =>
      `- [${violation.impact ?? 'n/a'}] ${violation.id}: ${violation.help}\n    ${violation.nodes.join('\n    ')}`,
  )
  return `runAxeCheck: нарушения доступности уровня critical/serious (${String(blocking.length)}, SRS-UX-035):\n${lines.join('\n')}`
}
