import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from '../shared/cx.js'
import './badge.css'

export type BadgeTone = 'success' | 'danger' | 'warning' | 'neutral'

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Раскраска — чисто визуальная семантика (`SRS-UX-021`), маппинг доменного enum статуса
   * (`order.status`, `verification_status`, ...) в `tone` — ответственность потребителя, `Badge`
   * ничего не знает про доменные enum. */
  readonly tone?: BadgeTone
  /** ОБЯЗАТЕЛЕН (не `?:`) — статус не передаётся только цветом/иконкой (`SRS-UX-019`/
   * `SRS-UX-034`), текст ВСЕГДА присутствует. */
  readonly children: ReactNode
}

const DEFAULT_TONE: BadgeTone = 'neutral'

/** Статус-метка (`SRS-UX-021`). Не знает про доменные enum — только `tone` + обязательный текст. */
export const Badge = ({ tone = DEFAULT_TONE, className, children, ...rest }: BadgeProps): ReactElement => (
  <span {...rest} className={cx('ui-badge', `ui-badge--${tone}`, className)}>
    {children}
  </span>
)
