import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useReducedMotion } from '../shared/a11y-runtime.js'
import { cx } from '../shared/cx.js'
import './countdown-timer.css'

const TICK_INTERVAL_MS = 1000
const SECONDS_PER_MINUTE = 60

export type CountdownTimerPhase = 'normal' | 'warning' | 'danger' | 'overdue'

export interface CountdownTimerProps {
  /** Unix-время цели в миллисекундах (например, конец SLA-окна сборки/резерва). */
  readonly targetTimestamp: number
  /** Порог предупреждения в СЕКУНДАХ до цели — НЕ хардкодится внутри компонента (риск тикета
   * DTJ-407: 7 минут SLA — значение `tenant_settings`/конкретного заказа, D-19). */
  readonly warningThresholdSeconds: number
  /** Порог "опасности" в СЕКУНДАХ до цели (обычно `0` — совпадает с моментом просрочки, но может
   * быть больше — например «последняя минута» отдельного сценария). */
  readonly dangerThresholdSeconds: number
  readonly className?: string
}

function computeRemainingSeconds(targetTimestamp: number): number {
  return Math.round((targetTimestamp - Date.now()) / 1000)
}

/**
 * `overdue` — СТРУКТУРНАЯ фаза обратного отсчёта (момент, когда `remainingSeconds` пересекает
 * ноль), не бизнес-константа — существует независимо от `dangerThresholdSeconds`, поэтому не
 * нарушает C6 (нет магического числа: сравнение именно с 0 — это определение «просрочено»).
 */
function resolvePhase(
  remainingSeconds: number,
  warningThresholdSeconds: number,
  dangerThresholdSeconds: number,
): CountdownTimerPhase {
  if (remainingSeconds < 0) {
    return 'overdue'
  }
  if (remainingSeconds < dangerThresholdSeconds) {
    return 'danger'
  }
  if (remainingSeconds <= warningThresholdSeconds) {
    return 'warning'
  }
  return 'normal'
}

/** `danger`/`overdue` — визуально ОДИН и тот же цвет (`--brand-danger`, тикет DTJ-407 п.6
 * называет только 3 цвета эскалации), но остаются разными `phase` для дискретных `aria-live`
 * оповещений на КАЖДОМ пороговом переходе, включая сам момент просрочки. */
function resolveVisualTone(phase: CountdownTimerPhase): 'normal' | 'warning' | 'danger' {
  return phase === 'overdue' ? 'danger' : phase
}

function formatDuration(totalSeconds: number): string {
  const isNegative = totalSeconds < 0
  const absoluteSeconds = Math.abs(totalSeconds)
  const minutes = Math.floor(absoluteSeconds / SECONDS_PER_MINUTE)
  const seconds = absoluteSeconds % SECONDS_PER_MINUTE
  const sign = isNegative ? '-' : ''
  return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Единственная реализация SLA/TTL-таймера в дизайн-системе (тикет DTJ-407 п.6, AGENTS.md §12 —
 * иначе дублировался бы SLA сборки фармацевтом и TTL резерва корзины/OTP). Цветовая эскалация
 * `--brand-text` → `--brand-warning` → `--brand-danger`; просрочка отображается ЯВНО отрицательным
 * временем, не скрывается и не клэмпится к нулю (AC2). Моно-ширина цифр — `font-variant-numeric:
 * tabular-nums` (countdown-timer.css), не смена шрифта — в токенах нет отдельного monospace-
 * семейства, а этого свойства достаточно для визуальной стабильности ширины.
 *
 * `aria-live="polite"` регион ОТДЕЛЁН от видимых цифр (`sr-only`) и обновляется ТОЛЬКО при смене
 * `phase` (AC1, `SRS-UX-034`) — видимые цифры тикают каждую секунду в обычном, не анонсируемом
 * узле, чтобы не зачитывать таймер целиком каждую секунду.
 */
export const CountdownTimer = ({
  targetTimestamp,
  warningThresholdSeconds,
  dangerThresholdSeconds,
  className,
}: CountdownTimerProps): ReactElement => {
  const prefersReducedMotion = useReducedMotion()
  const [remainingSeconds, setRemainingSeconds] = useState(() => computeRemainingSeconds(targetTimestamp))
  const [announcedTime, setAnnouncedTime] = useState(() => formatDuration(computeRemainingSeconds(targetTimestamp)))
  const previousPhaseRef = useRef<CountdownTimerPhase | null>(null)

  useEffect(() => {
    setRemainingSeconds(computeRemainingSeconds(targetTimestamp))
    const intervalId = setInterval(() => {
      setRemainingSeconds(computeRemainingSeconds(targetTimestamp))
    }, TICK_INTERVAL_MS)
    return () => {
      clearInterval(intervalId)
    }
  }, [targetTimestamp])

  const phase = resolvePhase(remainingSeconds, warningThresholdSeconds, dangerThresholdSeconds)

  useEffect(() => {
    if (previousPhaseRef.current === phase) {
      return
    }
    previousPhaseRef.current = phase
    setAnnouncedTime(formatDuration(remainingSeconds))
    // Депс намеренно только `[phase]` — анонс обязан обновляться ТОЛЬКО на смену фазы (SRS-UX-034/
    // AC1), не на каждый тик `remainingSeconds`; добавление `remainingSeconds` в зависимости
    // сломало бы дискретность оповещений. `remainingSeconds` внутри читается через замыкание
    // актуального рендера на момент смены `phase`, чего для этого эффекта достаточно.
  }, [phase])

  const visualTone = resolveVisualTone(phase)

  return (
    <div
      className={cx(
        'ui-countdown-timer',
        `ui-countdown-timer--${visualTone}`,
        !prefersReducedMotion && 'ui-countdown-timer--motion',
        className,
      )}
    >
      <span className="ui-countdown-timer__value">{formatDuration(remainingSeconds)}</span>
      <span className="ui-countdown-timer__sr-only" role="status" aria-live="polite">
        {announcedTime}
      </span>
    </div>
  )
}
