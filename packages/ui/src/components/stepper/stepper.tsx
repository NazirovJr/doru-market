/**
 * `Stepper` (DTJ-408, `SRS-UX-019`/`SRS-UX-034`) — прогресс чекаута (адрес → оплата →
 * подтверждение). Домен-агностичен: шаги приходят массивом `{ label, status }`, компонент не
 * знает, что это чекаут (переиспользуется онбордингом аптеки и т.п.).
 *
 * Состояния различаются НЕ только цветом (WCAG 1.4.1): `complete` — заполненный кружок с
 * галочкой, `current` — кольцо с заливкой (форма кружка отличается от `complete`/`upcoming`),
 * `upcoming` — пустой кружок с номером. Текущий шаг помечен `aria-current="step"`.
 */
import { type CSSProperties, type ReactElement } from 'react'

export type StepStatus = 'complete' | 'current' | 'upcoming'

export interface StepperStep {
  /** Текст подписи шага — переводится потребителем (i18n), не хардкод в компоненте. */
  readonly label: string
  readonly status: StepStatus
}

export interface StepperProps {
  readonly steps: readonly StepperStep[]
}

const MARKER_SIZE_PX = 28

const LIST_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-2)',
  listStyle: 'none',
  margin: 0,
  padding: 0,
  fontFamily: 'var(--brand-font-family)',
}

const ITEM_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-1)',
  flex: '1 1 0',
}

const CONNECTOR_STYLE = (filled: boolean): CSSProperties => ({
  flex: '1 1 auto',
  height: '2px',
  marginTop: `${String(MARKER_SIZE_PX / 2)}px`,
  background: filled ? 'var(--brand-primary)' : 'var(--brand-border)',
})

const CheckIcon = (): ReactElement => (
  <svg aria-hidden="true" width={14} height={14} viewBox="0 0 14 14" fill="none">
    <path d="M2.5 7.3 5.6 10.5 11.5 3.5" stroke="var(--brand-surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const MARKER_STYLE: Readonly<Record<StepStatus, CSSProperties>> = {
  complete: {
    background: 'var(--brand-primary)',
    border: '1px solid transparent',
    color: 'var(--brand-surface)',
  },
  current: {
    background: 'var(--brand-surface)',
    border: '2px solid var(--brand-primary)',
    color: 'var(--brand-primary)',
  },
  upcoming: {
    background: 'var(--brand-surface)',
    border: '1px solid var(--brand-border)',
    color: 'var(--brand-text-muted)',
  },
}

interface StepMarkerProps {
  readonly status: StepStatus
  readonly stepNumber: number
}

const StepMarker = ({ status, stepNumber }: StepMarkerProps): ReactElement => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      width: `${String(MARKER_SIZE_PX)}px`,
      height: `${String(MARKER_SIZE_PX)}px`,
      borderRadius: 'var(--radius-full)',
      fontSize: 'var(--font-size-xs)',
      fontWeight: 'var(--font-weight-semibold)',
      ...MARKER_STYLE[status],
    }}
  >
    {status === 'complete' ? <CheckIcon /> : stepNumber}
  </span>
)

const LABEL_STYLE = (status: StepStatus): CSSProperties => ({
  fontSize: 'var(--font-size-xs)',
  fontWeight: status === 'current' ? 'var(--font-weight-semibold)' : 'var(--font-weight-regular)',
  color: status === 'upcoming' ? 'var(--brand-text-muted)' : 'var(--brand-text)',
  textAlign: 'center',
})

export const Stepper = ({ steps }: StepperProps): ReactElement => (
  <ol style={LIST_STYLE}>
    {steps.map((step, index) => (
      <li
        key={step.label}
        style={{ display: 'flex', alignItems: 'flex-start', flex: index === steps.length - 1 ? '0 0 auto' : '1 1 0' }}
        aria-current={step.status === 'current' ? 'step' : undefined}
      >
        <div style={ITEM_STYLE}>
          <StepMarker status={step.status} stepNumber={index + 1} />
          <span style={LABEL_STYLE(step.status)}>{step.label}</span>
        </div>
        {index < steps.length - 1 && <div style={CONNECTOR_STYLE(step.status === 'complete')} />}
      </li>
    ))}
  </ol>
)
