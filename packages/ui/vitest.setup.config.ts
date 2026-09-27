// Подключает jest-dom матчеры (`toHaveFocus`, `toBeVisible`, ...) к `expect()` Vitest.
// DTJ-403: нужен a11y-тестам `packages/ui` (проверка фокуса в `use-focus-trap.spec.tsx`).
import '@testing-library/jest-dom/vitest'
