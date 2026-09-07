import type { ReactElement } from 'react'
import { cx } from '../shared/cx.js'
import './stepper.css'

export type StepStatus = 'complete' | 'current' | 'upcoming'

export interface StepItem {
  readonly label: string
  readonly status: StepStatus
}

export interface StepperProps {
  /** Шаги домен-агностичны (адрес → оплата → подтверждение чекаута, либо любой другой процесс) —
   * потребитель решает порядок и подписи. */
  readonly steps: readonly StepItem[]
  /** Доступное имя контейнера шагов — обязателен пропом (`AGENTS.md` «ноль хардкода строк»). */
  readonly 'aria-label': string
  readonly className?: string
}

/**
 * Индикатор прогресса чекаута (`SRS-UX-021`): текущий/пройденный/будущий шаг различаются НЕ только
 * цветом — разной ФОРМОЙ маркера (галочка/закрашенный кружок/пустое кольцо, `SRS-UX-034`
 * доступность для дальтоников). Домен-агностичен — принимает `{ label, status }[]`.
 */
export const Stepper = ({ steps, className, ...rest }: StepperProps): ReactElement => (
  <ol aria-label={rest['aria-label']} className={cx('ui-stepper', className)}>
    {steps.map((step, index) => (
      <li
        key={step.label}
        aria-current={step.status === 'current' ? 'step' : undefined}
        className={cx('ui-stepper__step', `ui-stepper__step--${step.status}`)}
      >
        <StepMarker status={step.status} stepNumber={index + 1} />
        <span className="ui-stepper__label">{step.label}</span>
      </li>
    ))}
  </ol>
)

interface StepMarkerProps {
  readonly status: StepStatus
  readonly stepNumber: number
}

const StepMarker = ({ status, stepNumber }: StepMarkerProps): ReactElement => (
  <span className="ui-stepper__marker" aria-hidden="true">
    {status === 'complete' ? <CheckIcon /> : <span className="ui-stepper__marker-number">{stepNumber}</span>}
  </span>
)

const CHECK_ICON_SIZE_PX = 14

const CheckIcon = (): ReactElement => (
  <svg width={CHECK_ICON_SIZE_PX} height={CHECK_ICON_SIZE_PX} viewBox="0 0 14 14" fill="none">
    <path d="M2.5 7.5 5.5 10.5 11.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
