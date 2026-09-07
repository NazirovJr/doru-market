import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithA11yCheck } from '../shared/a11y-testing.js'
import { Skeleton, type SkeletonVariant } from './skeleton.js'

const VARIANTS: readonly SkeletonVariant[] = ['text', 'row', 'card']

function installMatchMedia(matches: boolean): void {
  window.matchMedia = () =>
    ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }) as MediaQueryList
}

afterEach(() => {
  // @ts-expect-error тестовый мок matchMedia намеренно удаляется между тестами, чтобы следующий не унаследовал состояние
  delete window.matchMedia
})

describe('Skeleton — варианты', () => {
  it.each(VARIANTS)('рендерит variant=%s без ошибок, скрыт от screen reader', (variant) => {
    render(<Skeleton variant={variant} data-testid="skeleton" />)
    const el = screen.getByTestId('skeleton')
    expect(el).toHaveAttribute('aria-hidden', 'true')
  })

  it('ноль critical/serious a11y-нарушений', async () => {
    const { axeResults } = await renderWithA11yCheck(<Skeleton />)
    expect(axeResults).toHaveNoViolations()
  })
})

/**
 * AC5: `prefers-reduced-motion: reduce` — shimmer не запускается. ГРАНИЦЫ ПРОВЕРКИ: `jsdom` не
 * вычисляет `@media`-правила в `getComputedStyle` (реальный CSS-каскад `skeleton.css` с
 * `@keyframes`/`@media (prefers-reduced-motion: reduce)` в `jsdom` НЕ применяется вообще — см.
 * аналогичное наблюдение в `button.spec.tsx`, эта конфигурация `vitest` не прогоняет внешние
 * стили через layout-движок). Поэтому тест проверяет ЕДИНСТВЕННЫЙ канал, который `jsdom` реально
 * резолвит через `getComputedStyle` — inline `animationName`/`animationDuration`, которые
 * `skeleton.tsx` выставляет явно по значению `useReducedMotion()` (defense-in-depth поверх
 * `@media`, не замена ему — см. JSDoc `skeleton.tsx`). Что это ДОКАЗЫВАЕТ: компонент корректно
 * реагирует на смену системного предпочтения и синхронно отключает анимацию в своей собственной
 * разметке. Что это НЕ доказывает: реальное поведение `@media (prefers-reduced-motion: reduce)` в
 * браузере (это верифицируется визуально/Storybook + `@axe-core/playwright` E2E, не этим тестом).
 */
describe('Skeleton — prefers-reduced-motion (AC5)', () => {
  it('reduce=true — активная анимация отсутствует (animationName: none)', () => {
    installMatchMedia(true)
    render(<Skeleton data-testid="skeleton" />)

    const style = getComputedStyle(screen.getByTestId('skeleton'))
    expect(style.animationName).toBe('none')
  })

  it('reduce=false — shimmer-анимация активна (animationName выставлен)', () => {
    installMatchMedia(false)
    render(<Skeleton data-testid="skeleton" />)

    const style = getComputedStyle(screen.getByTestId('skeleton'))
    expect(style.animationName).toBe('ui-skeleton-shimmer')
    expect(style.animationDuration).toBe('1.4s')
  })
})
