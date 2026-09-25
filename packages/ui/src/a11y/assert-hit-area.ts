/**
 * `assertHitArea` (DTJ-403, SRS-UX-002, SRS-UX-034 «Кнопка/интерактивный элемент») — тестовая
 * утилита проверки ЭФФЕКТИВНОЙ области попадания интерактивного элемента.
 *
 * Эффективная область = content + padding + border (то, что принимает касание), а не только
 * визуальный размер содержимого: визуал можно оставить маленьким (расхождение №4
 * `docs/spec/32-design-reference.md`), если `padding` добирает тап-зону до минимума.
 *
 * Как считается:
 * - `getBoundingClientRect()` — в настоящем браузере это уже border-box с учётом padding;
 * - `getComputedStyle()` — `width`/`height` + `padding` + `border` с учётом `box-sizing`;
 *   нужен под `jsdom`, где раскладки нет и `getBoundingClientRect()` возвращает нули.
 * Берётся большее из двух: в браузере они совпадают, под `jsdom` работает второе.
 *
 * Техника hit-slop через ОТРИЦАТЕЛЬНЫЙ `margin` в v1 НЕ поддерживается и сознательно
 * игнорируется: отрицательный `margin` сдвигает раскладку соседей, но не увеличивает область,
 * принимающую касание (она по-прежнему равна border-box). Hit-slop через псевдоэлемент
 * (`::before` с отрицательным `inset`) под `jsdom` не измерим — такие компоненты проверяются
 * E2E-уровнем в реальном браузере.
 *
 * Сообщения ошибок адресованы разработчику в выводе тестов, а не пользователю, поэтому не
 * проходят через i18n.
 */

/** Минимальная тап-зона Customer Web/PWA/TWA (SRS-UX-002). */
export const MIN_HIT_AREA_PX = 48

/** Минимальная тап-зона критичных действий веб-кабинета аптеки (SRS-UX-002). */
export const CRITICAL_HIT_AREA_PX = 56

export interface HitAreaSize {
  readonly width: number
  readonly height: number
}

const parsePx = (value: string): number => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const sumPaddingPx = (style: CSSStyleDeclaration, properties: readonly string[]): number =>
  properties.reduce((total, property) => total + parsePx(style.getPropertyValue(property)), 0)

/**
 * Ширина рамки СТОРОНЫ элемента. По спецификации CSS вычисленная `border-*-width` всегда 0,
 * если `border-*-style` этой стороны — `none`/`hidden`, НЕЗАВИСИМО от заданного `border-width`
 * (initial-значение `border-width` — ключевое слово `medium`, которое не должно рендериться
 * без стиля рамки). Игнорировать это правило под `jsdom` опасно: реализация вычисляемых
 * стилей `jsdom` возвращает конкретное px-значение для `medium` даже когда `border-style`
 * не задан (по умолчанию `none`) — без этой проверки КАЖДЫЙ элемент без явной рамки получал
 * бы фантомные +32px к тап-зоне.
 */
const borderSidePx = (style: CSSStyleDeclaration, side: 'left' | 'right' | 'top' | 'bottom'): number => {
  const borderStyle = style.getPropertyValue(`border-${side}-style`)
  if (borderStyle === '' || borderStyle === 'none' || borderStyle === 'hidden') {
    return 0
  }
  return parsePx(style.getPropertyValue(`border-${side}-width`))
}

const PADDING_HORIZONTAL = ['padding-left', 'padding-right'] as const
const PADDING_VERTICAL = ['padding-top', 'padding-bottom'] as const

const measureFromStyle = (element: HTMLElement): HitAreaSize => {
  const style = getComputedStyle(element)
  const width = parsePx(style.width)
  const height = parsePx(style.height)
  if (style.boxSizing === 'border-box') {
    return { width, height }
  }
  return {
    width: width + sumPaddingPx(style, PADDING_HORIZONTAL) + borderSidePx(style, 'left') + borderSidePx(style, 'right'),
    height: height + sumPaddingPx(style, PADDING_VERTICAL) + borderSidePx(style, 'top') + borderSidePx(style, 'bottom'),
  }
}

/** Эффективная область попадания элемента в CSS px. */
export const measureHitArea = (element: HTMLElement): HitAreaSize => {
  const rect = element.getBoundingClientRect()
  const fromStyle = measureFromStyle(element)
  return {
    width: Math.max(rect.width, fromStyle.width),
    height: Math.max(rect.height, fromStyle.height),
  }
}

const formatPx = (value: number): string => String(Math.round(value * 100) / 100)

const describeElement = (element: HTMLElement): string => {
  const label = element.getAttribute('aria-label') ?? element.textContent.trim()
  return label === '' ? `<${element.tagName.toLowerCase()}>` : `<${element.tagName.toLowerCase()}> «${label}»`
}

/**
 * Бросает `Error`, если эффективная область попадания меньше `minSizePx`×`minSizePx`.
 * Текст ошибки содержит фактический и требуемый размер, например `32×32px < 48×48px`.
 */
export const assertHitArea = (element: HTMLElement, minSizePx: number): void => {
  if (!Number.isFinite(minSizePx) || minSizePx <= 0) {
    throw new RangeError(`assertHitArea: minSizePx должен быть положительным числом, получено ${String(minSizePx)}`)
  }
  const { width, height } = measureHitArea(element)
  if (width >= minSizePx && height >= minSizePx) {
    return
  }
  const actual = `${formatPx(width)}×${formatPx(height)}`
  const required = `${formatPx(minSizePx)}×${formatPx(minSizePx)}`
  throw new Error(
    `Тап-зона ${describeElement(element)} слишком мала: фактически ${actual}px < требуется ${required}px (SRS-UX-002).`,
  )
}
