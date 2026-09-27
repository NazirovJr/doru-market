/**
 * `skeleton.spec.tsx` (DTJ-404, критерий приёмки 5, тест-план тикета).
 *
 * `prefers-reduced-motion` под `jsdom` задаётся через мок `window.matchMedia` (тот же паттерн,
 * что `use-reduced-motion.spec.ts` DTJ-403). Отсутствие активной анимации проверяется через
 * `getComputedStyle(...).animation`: keyframes из `skeleton.css` — внешний файл, который vitest
 * не загружает по умолчанию, поэтому источник истины — inline `style.animation`, которую
 * компонент выставляет (или не выставляет) в зависимости от `useReducedMotion()` (см. JSDoc
 * `skeleton.tsx`).
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REDUCED_MOTION_QUERY } from '@/a11y/use-reduced-motion'
import { Skeleton, type SkeletonVariant } from './skeleton'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mockMatchMedia = (matches: boolean): void => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY && matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

describe('Skeleton — варианты формы', () => {
  const variants: readonly SkeletonVariant[] = ['text', 'card', 'row']
  it.each(variants)('рендерит variant=%s без ошибок', (variant) => {
    mockMatchMedia(false)
    const { container } = render(<Skeleton variant={variant} />)
    expect(container.firstChild).toBeInTheDocument()
  })
})

describe('Skeleton — reduced motion (AC5)', () => {
  it('запускает shimmer-анимацию, когда reduced motion выключен', () => {
    mockMatchMedia(false)
    const { container } = render(<Skeleton />)
    const element = container.firstElementChild as HTMLElement
    expect(getComputedStyle(element).animation).toContain('dorutj-shimmer')
  })

  it('не запускает shimmer-анимацию при prefers-reduced-motion: reduce (AC5)', () => {
    mockMatchMedia(true)
    const { container } = render(<Skeleton />)
    const element = container.firstElementChild as HTMLElement
    const animation = getComputedStyle(element).animation
    expect(animation === '' || animation === 'none').toBe(true)
  })
})
