/**
 * `Card` (DTJ-404, `SRS-UX-019`/`SRS-UX-021`) — базовая карточка-контейнер. `interactive` рендерит
 * `<a>` (если передан `href`) или `<button>` (иначе) со своим фокус-кольцом (`:focus`/`:focus-visible`
 * через `onFocus`/`onBlur` — inline-стили не поддерживают CSS псевдоклассы, см. `internal/motion.ts`
 * JSDoc); `static` — обычный `<div>`, не участвует в tab-order.
 *
 * Тап-зона `interactive`-карточки НЕ проверяется `assertHitArea` в юнит-тестах (в отличие от
 * `Button`/`IconButton`/`Chip`): `Card` — контейнер произвольного контента (в реальном использовании
 * всегда заметно больше 48×48px за счёт содержимого), а не элемент с намеренно уменьшенным визуалом,
 * которому нужен hit-slop через `padding` (тот приём применим только там, где визуал МЕНЬШЕ минимума
 * — `32-design-reference.md` расхождение №4). Под `jsdom` без реальной раскладки контента и без
 * явного `padding`-hit-slop эта проверка была бы ложноотрицательной — покрывается E2E (DTJ-417+).
 */
import { type MouseEventHandler, type ReactElement, type ReactNode, useState } from 'react'
import { useReducedMotion } from '@/a11y/use-reduced-motion'
import { buildTransition } from '../internal/motion'

interface CardStaticProps {
  readonly interactive?: false
  readonly children: ReactNode
  readonly className?: string
}

export interface CardInteractiveProps {
  readonly interactive: true
  readonly children: ReactNode
  readonly className?: string
  /** Если задан — карточка рендерится как `<a href>`, иначе как `<button>`. */
  readonly href?: string
  readonly onClick?: MouseEventHandler<HTMLElement>
  readonly 'aria-label'?: string
}

export type CardProps = CardStaticProps | CardInteractiveProps

const isInteractive = (props: CardProps): props is CardInteractiveProps => props.interactive === true

const useCardFocusStyle = (prefersReducedMotion: boolean): {
  readonly isFocused: boolean
  readonly focusHandlers: { onFocus: () => void; onBlur: () => void }
  readonly transition: string
} => {
  const [isFocused, setIsFocused] = useState(false)
  return {
    isFocused,
    focusHandlers: {
      onFocus: () => { setIsFocused(true) },
      onBlur: () => { setIsFocused(false) },
    },
    transition: buildTransition(['box-shadow'], prefersReducedMotion),
  }
}

const BASE_CARD_STYLE = {
  boxSizing: 'border-box' as const,
  display: 'block',
  padding: 'var(--space-4)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--brand-surface)',
  border: '1px solid var(--brand-border)',
  color: 'var(--brand-text)',
  fontFamily: 'var(--brand-font-family)',
  textDecoration: 'none',
}

export const Card = (props: CardProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const { isFocused, focusHandlers, transition } = useCardFocusStyle(prefersReducedMotion)

  if (!isInteractive(props)) {
    const { children, className } = props
    return (
      <div className={className} style={BASE_CARD_STYLE}>
        {children}
      </div>
    )
  }

  const { children, className, href, onClick, 'aria-label': ariaLabel } = props
  const focusStyle = {
    // `outline` подавляется только одновременно с заменой `box-shadow` (см. `button.tsx`).
    outline: isFocused ? 'none' : undefined,
    boxShadow: isFocused ? 'var(--focus-ring)' : 'none',
    transition,
    cursor: 'pointer',
  }

  if (href !== undefined) {
    return (
      <a
        href={href}
        onClick={onClick}
        aria-label={ariaLabel}
        className={className}
        {...focusHandlers}
        style={{ ...BASE_CARD_STYLE, ...focusStyle }}
      >
        {children}
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={className}
      {...focusHandlers}
      style={{ ...BASE_CARD_STYLE, ...focusStyle, width: '100%', textAlign: 'left' }}
    >
      {children}
    </button>
  )
}
