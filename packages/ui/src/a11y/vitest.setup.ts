// Глобальный setup Vitest для `packages/ui` (подключается через `vitest.config.ts`
// `test.setupFiles`). Регистрирует матчеры `@testing-library/jest-dom` (`toBeInTheDocument`,
// `toHaveAttribute` и т.д.) для ВСЕХ будущих `*.spec.tsx` пакета, не только `a11y/**`.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Без `globals: true` в конфиге `@testing-library/react` не регистрирует автоочистку между
// тестами сама — размонтируем вручную, иначе повторные `render()` в одном файле-споте копят DOM
// между тестами (несколько совпадений по тексту в `getByText` и т.п.).
afterEach(() => {
  cleanup()
})
