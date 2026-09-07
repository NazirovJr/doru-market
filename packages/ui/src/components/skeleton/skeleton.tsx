import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './skeleton.css'

export type SkeletonVariant = 'text' | 'card' | 'row'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Форма плейсхолдера: `text` — строка текста, `row` — строка списка/таблицы, `card` — карточка
   * (`SRS-UX-021`). */
  readonly variant?: SkeletonVariant
}

const SHIMMER_ANIMATION_NAME = 'ui-skeleton-shimmer'
const SHIMMER_DURATION = '1.4s'
const NO_ANIMATION_DURATION = '0s'

function getMotionStyle(prefersReducedMotion: boolean): CSSProperties {
  return prefersReducedMotion
    ? { animationName: 'none', animationDuration: NO_ANIMATION_DURATION }
    : { animationName: SHIMMER_ANIMATION_NAME, animationDuration: SHIMMER_DURATION }
}

/**
 * Плейсхолдер загрузки (`SRS-UX-021`) — декоративный, скрыт от screen reader (`aria-hidden`,
 * реальный статус загрузки объявляет контейнер-потребитель через `aria-busy`/`aria-live`, не сам
 * скелет). Shimmer — CSS `@keyframes` (`skeleton.css`), уважает `prefers-reduced-motion` ДВАЖДЫ: и
 * медиа-запросом в CSS (реальный браузер), и `useReducedMotion()` inline-стилем (тестируемо и
 * устойчиво к моменту гидратации).
 */
export const Skeleton = ({ variant = 'text', className, style, ...rest }: SkeletonProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()

  return (
    <div
      {...rest}
      aria-hidden="true"
      className={cx('ui-skeleton', `ui-skeleton--${variant}`, className)}
      style={{ ...getMotionStyle(prefersReducedMotion), ...style }}
    />
  )
}
