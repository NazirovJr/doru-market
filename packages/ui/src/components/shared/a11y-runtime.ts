/**
 * Точка входа `src/components/**` в ПРОДАКШН-утилиты доступности `src/a11y/**` (DTJ-403) — только
 * хуки, которые реально исполняются в браузере потребителя (`useReducedMotion`, `useFocusTrap`).
 * Намеренно ОТДЕЛЕНА от `a11y-testing.ts` (`assertHitArea`, `renderWithA11yCheck`), который тянет
 * `axe-core` + `@testing-library/react` — те не имеют права попасть в прод-бандл `vite build`
 * (`SRS-UX-036`, бюджет ≤250KB gzip). Проверено: без разделения `axe-core`/`@testing-library/react`
 * действительно попадали в `dist/index.js` (замерено `vite build` — 536KB gzip вместо ожидаемых
 * единиц KB), потому что `packages/ui/package.json` не объявляет `"sideEffects": false`, и Rollup
 * консервативно включает весь реэкспортирующий модуль целиком, даже если конкретный биндинг не
 * используется. См. также `a11y-utils.ts` — то же обоснование `../../a11y/*`-импорта (C16).
 */
/* eslint-disable no-restricted-imports -- alias "@/" не резолвится ни vite build, ни vitest run в текущей конфигурации packages/ui (файлы конфигурации вне скоупа DTJ-404), см. отчёт сдачи DTJ-404 «БЛОКЕРЫ» */
export { useReducedMotion } from '../../a11y/use-reduced-motion.js'
export { useFocusTrap } from '../../a11y/use-focus-trap.js'
/* eslint-enable no-restricted-imports */
