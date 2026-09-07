import type { JSX } from 'react'

/**
 * Фикстура-нарушитель для самопроверки `renderWithA11yCheck` («ловушку нужно проверять
 * ловушкой», `docs/02-CLEAN-ARCHITECTURE-AND-CODE.md` §6.1) — тест `test-utils.spec.tsx`
 * проверяет, что проверка РЕАЛЬНО ловит нарушение, а не просто зелёная по умолчанию.
 *
 * Визуально убран `outline` — намеренное нарушение `SRS-UX-034` «видимый focus». ВАЖНО: сам по
 * себе `outline: none` axe-core НЕ обнаруживает ни в одном окружении — видимость фокус-индикатора
 * (WCAG 2.4.7) не входит в автоматизируемые правила axe-core (это ограничение движка, а не
 * `jsdom`). Поэтому фикстура дополнительно содержит структурное нарушение, которое axe-core
 * реально ловит под `jsdom`: кнопка-иконка без доступного имени (`aria-label`) — правило
 * `button-name` (WCAG 4.1.2, `impact: critical`), тот же пункт чек-листа `SRS-UX-034`
 * («доступное имя, если только иконка, не `icon-button-1`»).
 */
export const BrokenFocusButton = (): JSX.Element => (
  <button type="button" style={{ outline: 'none' }}>
    <span aria-hidden="true">×</span>
  </button>
)
