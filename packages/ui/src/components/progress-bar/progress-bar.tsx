import { useId, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { cx } from '../shared/cx.js'
import './progress-bar.css'

const PERCENT_MIN = 0
const PERCENT_MAX = 100

function clampPercent(value: number): number {
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, value))
}

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0–100 (`SRS-UX-021`), значения за пределами диапазона обрезаются. */
  readonly value: number
  /** Подпись прогресса — УЖЕ переведённый текст (вызывающий код прогоняет свой `labelKey` через
   * `useT()` до передачи сюда, тот же паттерн, что `Button.children`/`Badge.children`: `ProgressBar`
   * — генерический компонент, а не владелец канонической i18n-строки, в отличие от
   * `EmptyState`/`ErrorState`/`OfflineBanner`, DoD DTJ-406 их не касается). */
  readonly label?: ReactNode
  readonly className?: string
}

/**
 * Базовая генерическая версия (`SRS-UX-021`, 0–100%). Агрегирующий Excel-импорта вариант (N
 * батчей, `SRS-INV-014`) — ВНЕ зоны этого тикета (`32-design-reference.md` §«Пробелы дизайна»),
 * реализуется тем эпиком, чей экран его первым потребует, как обёртка над ЭТИМ компонентом.
 */
export const ProgressBar = ({ value, label, className, ...rest }: ProgressBarProps): ReactElement => {
  const percent = clampPercent(value)
  const labelId = useId()
  const hasLabel = label !== undefined

  return (
    <div {...rest} className={cx('ui-progress-bar', className)}>
      {hasLabel ? (
        <div id={labelId} className="ui-progress-bar__label">
          {label}
        </div>
      ) : null}
      <div
        className="ui-progress-bar__track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={PERCENT_MIN}
        aria-valuemax={PERCENT_MAX}
        aria-labelledby={hasLabel ? labelId : undefined}
      >
        <div className="ui-progress-bar__fill" style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  )
}
