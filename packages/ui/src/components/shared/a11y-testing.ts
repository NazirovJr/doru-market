/**
 * Точка входа `src/components/**` в ТЕСТОВЫЕ утилиты доступности `src/a11y/**` (DTJ-403) —
 * `assertHitArea`/`measureHitArea`/`renderWithA11yCheck` (тянет `axe-core` +
 * `@testing-library/react`). Импортируется ТОЛЬКО из `*.spec.tsx` — производственные компоненты
 * берут хуки из `a11y-runtime.ts`, чтобы эти зависимости не попали в `vite build` (`SRS-UX-036`).
 */
/* eslint-disable no-restricted-imports -- alias "@/" не резолвится ни vite build, ни vitest run в текущей конфигурации packages/ui (файлы конфигурации вне скоупа DTJ-404), см. отчёт сдачи DTJ-404 «БЛОКЕРЫ» */
export { assertHitArea, measureHitArea } from '../../a11y/assert-hit-area.js'
export type { HitAreaSize } from '../../a11y/assert-hit-area.js'
export { renderWithA11yCheck, getBlockingViolations } from '../../a11y/test-utils.js'
export type { A11yCheckResult } from '../../a11y/test-utils.js'
/* eslint-enable no-restricted-imports */
