/**
 * Общие константы переходов между состояниями (DTJ-404, `SRS-UX-019`/`SRS-UX-020`).
 *
 * Переходы между состояниями (`default → hover/active/focus/loading`) обязаны укладываться
 * в ≤200мс и уважать `useReducedMotion()` — при включённом предпочтении смена состояния
 * происходит мгновенно (`buildTransition` возвращает `'none'`), без анимации.
 *
 * `framer-motion` НЕ используется (риск тикета DTJ-404: библиотека непропорционально тяжела
 * для простых fade/scale-переходов кнопки/чипа и не объявлена в зависимостях `@dorutj/ui`,
 * см. НУЖНЫЕ ЗАВИСИМОСТИ в отчёте) — переходы реализованы через CSS `transition`, что даёт тот
 * же визуальный результат (≤200мс, уважает reduced-motion) без веса дополнительной библиотеки.
 */

/** Длительность перехода между состояниями (`SRS-UX-020`: ≤200мс). */
export const TRANSITION_MS = 200

/** Масштаб нажатого состояния `active`/`pressed` (`SRS-UX-019`). */
export const ACTIVE_SCALE = 0.97

/** Непрозрачность состояния `disabled` (`SRS-UX-019`). */
export const DISABLED_OPACITY = 0.45

/**
 * Строит значение CSS `transition` для переданных свойств, уважая `prefers-reduced-motion`.
 * При включённом предпочтении возвращает `'none'` — мгновенная смена состояния без анимации.
 */
export const buildTransition = (
  properties: readonly string[],
  prefersReducedMotion: boolean,
): string => {
  if (prefersReducedMotion || properties.length === 0) {
    return 'none'
  }
  return properties.map((property) => `${property} ${String(TRANSITION_MS)}ms ease`).join(', ')
}
