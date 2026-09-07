import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactElement, ReactNode } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './card.css'

interface CardCommonProps {
  /** `interactive` рендерит фокусируемый `<a>`/`<button>` со своим фокус-кольцом (`--focus-ring`),
   * `static` (по умолчанию) — обычный `<div>`, никогда не попадает в tab-order (`SRS-UX-021`). */
  readonly interactive?: boolean
  readonly children: ReactNode
  readonly className?: string
}

export type CardProps =
  | (CardCommonProps & { readonly interactive: true; readonly href: string } & Omit<
        AnchorHTMLAttributes<HTMLAnchorElement>,
        'className' | 'children' | 'href'
      >)
  | (CardCommonProps & { readonly interactive?: false; readonly href?: undefined } & Omit<
        HTMLAttributes<HTMLDivElement>,
        'className' | 'children'
      >)
  | (CardCommonProps & { readonly interactive: true; readonly href?: undefined } & Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        'className' | 'children' | 'type'
      >)

function getCardClassName(interactive: boolean, isMotionEnabled: boolean, className: string | undefined): string {
  return cx('ui-card', interactive && 'ui-card--interactive', interactive && isMotionEnabled && 'ui-card--motion', className)
}

/** Базовая карточка-контейнер (`SRS-UX-021`): `padding: var(--space-4)`, `border-radius:
 * var(--radius-md)`. `interactive` + `href` → `<a>`, `interactive` без `href` → `<button>`,
 * иначе → обычный `<div>`. */
export const Card = (props: CardProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const { interactive = false, href, className, children, ...rest } = props
  const classes = getCardClassName(interactive, !prefersReducedMotion, className)

  if (interactive && href !== undefined) {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} href={href} className={classes}>
        {children}
      </a>
    )
  }

  if (interactive) {
    return (
      <button {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)} type="button" className={classes}>
        {children}
      </button>
    )
  }

  return (
    <div {...(rest as HTMLAttributes<HTMLDivElement>)} className={classes}>
      {children}
    </div>
  )
}
