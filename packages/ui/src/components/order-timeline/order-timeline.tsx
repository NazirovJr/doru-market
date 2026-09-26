/**
 * `OrderTimeline` (DTJ-407, `SRS-UX-002`/`SRS-UX-021`/`SRS-UX-034`) — вертикальная шкала статусов
 * заказа. Домен-агностична (§«Что сделать» п.7 тикета): принимает уже готовый массив шагов
 * (`status`/`label`/`timestamp`/`isCompleted`/`isCurrent`), маппинг конкретных значений
 * `order_status`-enum (`packages/contracts/src/orders.ts`, `OrderStatus`) на шаги и их текст —
 * ответственность ПОТРЕБИТЕЛЯ (`entities`-слой фронта), не этого компонента. `status` здесь —
 * `string` (НЕ узкий `OrderStatus`), т.к. `packages/ui` не объявляет `@dorutj/contracts`
 * зависимостью (тот же приём, что `cursor-list`/`MedicineCard.controlCategory`, отчёт DTJ-408).
 *
 * Визуальное отличие текущего шага — НЕ только цветом (`SRS-UX-034`, WCAG 1.4.1): `isCurrent`
 * рендерит маркер РОМБОМ (иная ФОРМА, не круг), `isCompleted` — заполненный круг с иконкой
 * галочки, ожидающий шаг — пустой круг. `aria-current="step"` — на текущем шаге для
 * ассистивных технологий (тот же приём, что `Stepper`, DTJ-408 — переиспользование конвенции).
 *
 * Время шага форматируется через `formatDate`/`formatTime` (`@dorutj/i18n`, DTJ-402) — единственное
 * место форматирования дат в этом слое, компонент не делает собственный `Date`-парсинг помимо
 * вызова этих функций. Шаг без `timestamp` (`null`) — ещё не наступил, время не рендерится.
 * `locale`-проп НЕ нужен: `formatDate`/`formatTime` намеренно ОДИНАКОВЫ для всех локалей
 * (`ДД.ММ.ГГГГ`/`ЧЧ:ММ`, JSDoc `format-date.ts`, `SRS-UX-031`) — добавление неиспользуемого
 * пропа «на будущее» запрещено (мёртвый код в публичном API).
 */
import { type CSSProperties, type ReactElement } from 'react'
import { formatDate, formatTime } from '@dorutj/i18n'

export interface OrderTimelineStep {
  /** Сырое доменное значение статуса (например `order_status` enum) — не используется в разметке
   *  напрямую, передаётся для идентификации шага потребителем (`key`, аналитика и т.п.). */
  readonly status: string
  /** Текст шага — уже переведён потребителем (`useT()`), НЕ хардкод в этом компоненте. */
  readonly label: string
  /** `null` — шаг ещё не наступил, время не отображается. */
  readonly timestamp: Date | null
  readonly isCompleted: boolean
  readonly isCurrent: boolean
}

export interface OrderTimelineProps {
  readonly steps: readonly OrderTimelineStep[]
}

const MARKER_SIZE_PX = 20
const CHECK_ICON_SIZE_PX = 12

const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  listStyle: 'none',
  margin: 0,
  padding: 0,
  fontFamily: 'var(--brand-font-family)',
}

const CheckIcon = (): ReactElement => (
  <svg aria-hidden="true" width={CHECK_ICON_SIZE_PX} height={CHECK_ICON_SIZE_PX} viewBox="0 0 14 14" fill="none">
    <path d="M2.5 7.3 5.6 10.5 11.5 3.5" stroke="var(--brand-surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

interface StepMarkerProps {
  readonly isCompleted: boolean
  readonly isCurrent: boolean
}

/** Форма маркера различает `isCurrent` (ромб) от `isCompleted`/upcoming (круг) — не только цвет. */
const StepMarker = ({ isCompleted, isCurrent }: StepMarkerProps): ReactElement => {
  const baseStyle: CSSProperties = {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: `${String(MARKER_SIZE_PX)}px`,
    height: `${String(MARKER_SIZE_PX)}px`,
  }

  if (isCompleted) {
    return (
      <span
        aria-hidden="true"
        data-testid="order-timeline-marker-completed"
        style={{ ...baseStyle, borderRadius: 'var(--radius-full)', background: 'var(--brand-primary)', border: '1px solid transparent' }}
      >
        <CheckIcon />
      </span>
    )
  }

  if (isCurrent) {
    return (
      <span
        aria-hidden="true"
        data-testid="order-timeline-marker-current"
        style={{
          ...baseStyle,
          borderRadius: 'var(--radius-sm)',
          transform: 'rotate(45deg)',
          background: 'var(--brand-surface)',
          border: '2px solid var(--brand-primary)',
        }}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      data-testid="order-timeline-marker-upcoming"
      style={{ ...baseStyle, borderRadius: 'var(--radius-full)', background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
    />
  )
}

interface StepRowProps {
  readonly step: OrderTimelineStep
  readonly isLast: boolean
}

const CONNECTOR_STYLE = (filled: boolean): CSSProperties => ({
  width: '2px',
  flex: '1 1 auto',
  minHeight: 'var(--space-4)',
  marginLeft: `${String(MARKER_SIZE_PX / 2 - 1)}px`,
  background: filled ? 'var(--brand-primary)' : 'var(--brand-border)',
})

const StepRow = ({ step, isLast }: StepRowProps): ReactElement => (
  <li
    style={{ display: 'flex', flexDirection: 'column' }}
    aria-current={step.isCurrent ? 'step' : undefined}
    data-testid="order-timeline-step"
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
      <StepMarker isCompleted={step.isCompleted} isCurrent={step.isCurrent} />
      <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 'var(--space-1)' }}>
        <span
          style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: step.isCurrent ? 'var(--font-weight-semibold)' : 'var(--font-weight-regular)',
            color: step.isCompleted || step.isCurrent ? 'var(--brand-text)' : 'var(--brand-text-muted)',
          }}
        >
          {step.label}
        </span>
        {step.timestamp !== null && (
          <span data-testid="order-timeline-step-time" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--brand-text-muted)' }}>
            {formatDate(step.timestamp)} {formatTime(step.timestamp)}
          </span>
        )}
      </div>
    </div>
    {!isLast && (
      <div style={{ display: 'flex' }}>
        <div style={CONNECTOR_STYLE(step.isCompleted)} />
      </div>
    )}
  </li>
)

export const OrderTimeline = ({ steps }: OrderTimelineProps): ReactElement => (
  <ol style={LIST_STYLE}>
    {steps.map((step, index) => (
      <StepRow key={step.status + String(index)} step={step} isLast={index === steps.length - 1} />
    ))}
  </ol>
)
