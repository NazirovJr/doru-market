const PX_UNIT = 'px'

export interface HitAreaSize {
  readonly widthPx: number
  readonly heightPx: number
}

/**
 * Вычисляет ЭФФЕКТИВНУЮ область попадания элемента — рендерённый бокс (`getBoundingClientRect`)
 * плюс `padding` (`getComputedStyle`), а не только визуальный размер (`SRS-UX-002`, расхождение
 * №4 `docs/spec/32-design-reference.md`: дизайн рисует элементы мельче 48px, но фактическая
 * область попадания обязана быть достаточной за счёт padding/hit-slop).
 *
 * ОГРАНИЧЕНИЕ ПРИМЕНИМОСТИ (важно понимать перед использованием в новых тестах):
 * - `jsdom` не выполняет layout — `getBoundingClientRect()` в `jsdom` без явного мока ВСЕГДА
 *   возвращает нули. В unit-тестах ширину/высоту нужно выставлять явно (мок
 *   `element.getBoundingClientRect`), а `padding` читается через `getComputedStyle`, который
 *   `jsdom` резолвит корректно ТОЛЬКО для явно заданных `px`-значений (инлайн-стиль или простой
 *   CSS-класс) — проценты/`em`/сложный каскад `jsdom` не пересчитывает так же надёжно, как
 *   реальный браузер.
 * - В РЕАЛЬНОМ браузере `getBoundingClientRect()` уже включает `padding` (это render-box) —
 *   складывать их там было бы двойным счётом. Эта функция рассчитана именно на unit-уровень
 *   `jsdom`, где `getBoundingClientRect` мокается как «визуальный» размер элемента (то, что
 *   нарисовано/видно), а `padding` — как невидимая надбавка тач-зоны (hit-slop). Итоговая
 *   геометрия на реальном экране обязана быть перепроверена браузерным E2E-тестом (`TC-UX-001`,
 *   Playwright) — эта функция ловит регресс в компоненте до рендера в браузере, не заменяет его.
 * - `margin` (в т.ч. отрицательный) НЕ учитывается: margin не увеличивает собственную
 *   кликабельную область элемента ни в одном браузере (клик по области отрицательного margin
 *   попадает в то, что физически там отрисовано — соседний элемент/родителя, не в текущий),
 *   поэтому техника «hit-slop через отрицательный margin» этой функцией не поддерживается —
 *   это осознанное ограничение v1, а не недосмотр.
 */
export function measureHitArea(element: HTMLElement): HitAreaSize {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)

  const horizontalPaddingPx = parsePx(style.paddingLeft) + parsePx(style.paddingRight)
  const verticalPaddingPx = parsePx(style.paddingTop) + parsePx(style.paddingBottom)

  return {
    widthPx: rect.width + horizontalPaddingPx,
    heightPx: rect.height + verticalPaddingPx,
  }
}

/**
 * Тестовая утилита: бросает читаемую ошибку, если эффективная область попадания элемента
 * (см. `measureHitArea`) меньше `minSizePx` хотя бы по одному измерению (`SRS-UX-002`: 48×48px
 * по умолчанию, 56×56px для критичных действий кабинета аптеки).
 */
export function assertHitArea(element: HTMLElement, minSizePx: number): void {
  const { widthPx, heightPx } = measureHitArea(element)

  if (widthPx >= minSizePx && heightPx >= minSizePx) {
    return
  }

  throw new Error(
    `Hit-area too small: actual ${formatSize(widthPx, heightPx)}, required ${formatSize(minSizePx, minSizePx)} minimum (SRS-UX-002).`,
  )
}

function formatSize(widthPx: number, heightPx: number): string {
  return `${String(widthPx)}×${String(heightPx)}`
}

function parsePx(value: string): number {
  if (!value.endsWith(PX_UNIT)) {
    return 0
  }
  const parsed = Number.parseFloat(value)
  return Number.isNaN(parsed) ? 0 : parsed
}
