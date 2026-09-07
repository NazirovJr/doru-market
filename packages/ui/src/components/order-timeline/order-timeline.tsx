import type { ReactElement, ReactNode } from 'react'
import { cx } from '../shared/cx.js'
import './order-timeline.css'

export interface OrderTimelineStep {
  /** Стабильный идентификатор шага (ключ React-списка) — НЕ обязан совпадать с `order_status`
   * enum дословно, маппинг делает потребитель-фича (тикет DTJ-407 п.7, компонент домен-агностичен). */
  readonly id: string
  /** Уже локализованный текст статуса — этот компонент не переводит `order_status` в текст. */
  readonly status: ReactNode
  /** Уже отформатированное время (`formatDate`/`formatRelativeDate`, DTJ-402) — опционален, пока
   * шаг ещё не наступил. */
  readonly timestamp?: ReactNode
  readonly isCompleted: boolean
  readonly isCurrent: boolean
}

export interface OrderTimelineProps {
  readonly steps: readonly OrderTimelineStep[]
  readonly className?: string
}

/** Три РАЗНЫЕ формы маркера — `isCurrent` отличим не только цветом (тест-план DTJ-407 п.7). */
const PendingMarker = (): ReactElement => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const CompletedMarker = (): ReactElement => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="currentColor" />
    <path d="M5 8.2l2 2 4-4.4" stroke="var(--brand-surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const CurrentMarker = (): ReactElement => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
  </svg>
)

function resolveMarker(step: OrderTimelineStep): ReactElement {
  if (step.isCurrent) {
    return <CurrentMarker />
  }
  if (step.isCompleted) {
    return <CompletedMarker />
  }
  return <PendingMarker />
}

/**
 * Вертикальная шкала статусов заказа (`SRS-UX-021`, тикет DTJ-407 п.7) — домен-агностична:
 * маппинг конкретных `order_status` на шаги делает потребитель. Каждый шаг — иконка + время +
 * текст, `isCurrent` отличим ФОРМОЙ маркера (квадрат), не только цветом.
 */
export const OrderTimeline = ({ steps, className }: OrderTimelineProps): ReactElement => (
  <ol className={cx('ui-order-timeline', className)}>
    {steps.map((step) => (
      <li
        key={step.id}
        className={cx(
          'ui-order-timeline__step',
          step.isCompleted && 'ui-order-timeline__step--completed',
          step.isCurrent && 'ui-order-timeline__step--current',
        )}
        aria-current={step.isCurrent ? 'step' : undefined}
      >
        <span className="ui-order-timeline__marker">{resolveMarker(step)}</span>
        <div className="ui-order-timeline__content">
          <p className="ui-order-timeline__status">{step.status}</p>
          {step.timestamp !== undefined ? <p className="ui-order-timeline__timestamp">{step.timestamp}</p> : null}
        </div>
      </li>
    ))}
  </ol>
)
