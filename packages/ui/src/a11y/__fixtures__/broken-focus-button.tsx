/**
 * `broken-focus-button.tsx` (DTJ-403, тест-план — «самопроверочный тест», по аналогии с
 * фикстурами-нарушителями `tests/arch/` из `02-CLEAN-ARCHITECTURE-AND-CODE.md` §6.1).
 *
 * НАМЕРЕННО нарушает WCAG 2.4.7 (SRS-UX-019 «focus ВСЕГДА видим»): подавляет `outline` в фокусе
 * без замены через `box-shadow`. Используется ТОЛЬКО тестом `test-utils.spec.ts`, который
 * проверяет, что `renderWithA11yCheck` реально ЛОВИТ это нарушение — если тест зелёный без
 * нарушений, значит сама проверка сломана. Не импортировать за пределами тестов этого пакета.
 */
import { type ReactElement } from 'react'

export const BrokenFocusButton = (): ReactElement => (
  <button type="button" style={{ outline: 'none' }}>
    Кнопка без видимого фокуса
  </button>
)
