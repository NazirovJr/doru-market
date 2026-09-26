/**
 * `CountdownTimer` (DTJ-407, `SRS-UX-002`/`SRS-UX-034`) — единственная реализация обратного
 * отсчёта в `packages/ui` (устраняет дублирование SLA сборки аптекой / TTL резерва корзины/OTP,
 * §«Задача» тикета — эталонная цветовая эскалация уже подтверждена хорошей практикой в
 * `32-design-reference.md`).
 *
 * Пороги `warningThresholdSeconds`/`dangerThresholdSeconds` — ОБЯЗАТЕЛЬНЫЕ пропы, НЕ хардкод
 * (риск тикета: «если разработчик по ошибке зашьёт 420 как дефолт внутри компонента — нарушение
 * C6/блокирующее ревью-замечание»). Конкретное SLA-время («7 минут сборки») — решение бэкенда
 * конкретного эпика/`tenant_settings` (D-19), этот компонент про него ничего не знает.
 *
 * Источник времени — ИНЖЕКТИРУЕМЫЙ проп `getNow` (по умолчанию `Date.now`), а не скрытый вызов
 * `Date.now()` внутри логики расчёта (`computeRemainingSeconds`/`resolveEscalationStatus` — чистые
 * функции, тестируемые без моков глобального времени, только с фейковым `getNow`).
 *
 * Цветовая эскалация СТРОГО через `--brand-text` → `--brand-warning` → `--brand-danger`
 * (§«Что сделать» п.6): `danger`, когда `remainingSeconds <= dangerThresholdSeconds` (включает
 * просрочку — `remainingSeconds < 0` тоже `<= 0` при типичном `dangerThresholdSeconds = 0`),
 * иначе `warning`, когда `remainingSeconds <= warningThresholdSeconds`, иначе — дефолт. Просрочка
 * отображается ЯВНО отрицательным числом (`-MM:SS`), не клэмпится к нулю и не скрывается
 * (критерий приёмки 2).
 *
 * `aria-live` (критерий приёмки 1, `SRS-UX-034` «Screen reader»): видимые цифры — `role="timer"
 * aria-live="off"` (они меняются каждую секунду — живой регион на них спамил бы озвучкой).
 * ОТДЕЛЬНЫЙ visually-hidden `aria-live="polite"` регион обновляется ТОЛЬКО когда меняется
 * КАТЕГОРИЯ эскалации (`default → warning → danger`), не на каждый тик — иначе экранный диктор
 * читал бы значение каждую секунду, что прямо запрещено критерием приёмки 1.
 *
 * Моно-цифры (визуальная стабильность ширины при смене значений, §«Что сделать» п.6):
 * `fontVariantNumeric: 'tabular-nums'` — основная гарантия (цифры фиксированной ширины даже в
 * пропорциональном `--brand-font-family`) + запасной моноширинный стек шрифта (буквальное
 * требование текста тикета «моно-шрифт для цифр»), а НЕ `--brand-font-family`: это не цвет и не
 * пользовательская строка (AGENTS.md правило 9 их не запрещает), а системный fallback-стек —
 * тот же класс решения, что запасной стек `--brand-font-family` в `tokens/typography.css`.
 */
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react'

export type CountdownEscalationStatus = 'default' | 'warning' | 'danger'

export interface CountdownTimerProps {
  /** Целевой момент времени (epoch-миллисекунды), до которого идёт отсчёт. */
  readonly targetTimestamp: number
  /** Порог предупреждения, секунды ДО цели (НЕ хардкодить — см. JSDoc модуля). */
  readonly warningThresholdSeconds: number
  /** Порог просрочки/danger, секунды ДО цели (НЕ хардкодить — см. JSDoc модуля). */
  readonly dangerThresholdSeconds: number
  /** Источник текущего времени — по умолчанию `Date.now`, инжектируется тестами. */
  readonly getNow?: () => number
}

const TICK_INTERVAL_MS = 1000
const SECONDS_PER_MINUTE = 60
const MILLISECONDS_PER_SECOND = 1000
const PAD_WIDTH = 2
const PAD_CHAR = '0'

const MONO_FONT_STACK = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"

/** Given `targetTimestamp`/`getNow`, секунд до цели (может быть отрицательным — просрочка). */
export function computeRemainingSeconds(targetTimestamp: number, getNow: () => number): number {
  return Math.ceil((targetTimestamp - getNow()) / MILLISECONDS_PER_SECOND)
}

/**
 * Категория цветовой эскалации по порогам. `danger` проверяется ПЕРВОЙ (просрочка приоритетнее
 * предупреждения, даже если оба порога формально совпадают).
 */
export function resolveEscalationStatus(
  remainingSeconds: number,
  warningThresholdSeconds: number,
  dangerThresholdSeconds: number,
): CountdownEscalationStatus {
  if (remainingSeconds <= dangerThresholdSeconds) {
    return 'danger'
  }
  if (remainingSeconds <= warningThresholdSeconds) {
    return 'warning'
  }
  return 'default'
}

function pad2(value: number): string {
  return String(value).padStart(PAD_WIDTH, PAD_CHAR)
}

/** `MM:SS`, с явным знаком «-» для просрочки (критерий приёмки 2) — не клэмпится к нулю. */
export function formatCountdown(remainingSeconds: number): string {
  const isNegative = remainingSeconds < 0
  const absSeconds = Math.abs(remainingSeconds)
  const minutes = Math.floor(absSeconds / SECONDS_PER_MINUTE)
  const seconds = absSeconds % SECONDS_PER_MINUTE
  return `${isNegative ? '-' : ''}${pad2(minutes)}:${pad2(seconds)}`
}

const ESCALATION_COLOR: Readonly<Record<CountdownEscalationStatus, string>> = {
  default: 'var(--brand-text)',
  warning: 'var(--brand-warning)',
  danger: 'var(--brand-danger)',
}

const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

export const CountdownTimer = ({
  targetTimestamp,
  warningThresholdSeconds,
  dangerThresholdSeconds,
  getNow = Date.now,
}: CountdownTimerProps): ReactElement => {
  const [remainingSeconds, setRemainingSeconds] = useState(() => computeRemainingSeconds(targetTimestamp, getNow))
  const [announcedText, setAnnouncedText] = useState('')
  const statusRef = useRef<CountdownEscalationStatus>(
    resolveEscalationStatus(remainingSeconds, warningThresholdSeconds, dangerThresholdSeconds),
  )

  useEffect(() => {
    setRemainingSeconds(computeRemainingSeconds(targetTimestamp, getNow))
    const intervalId = setInterval(() => {
      setRemainingSeconds(computeRemainingSeconds(targetTimestamp, getNow))
    }, TICK_INTERVAL_MS)
    return () => { clearInterval(intervalId) }
  }, [targetTimestamp, getNow])

  useEffect(() => {
    const status = resolveEscalationStatus(remainingSeconds, warningThresholdSeconds, dangerThresholdSeconds)
    if (status !== statusRef.current) {
      statusRef.current = status
      // Обновление ТОЛЬКО на пороговом переходе — единственная запись в aria-live регион
      // (критерий приёмки 1), не на каждый тик.
      setAnnouncedText(formatCountdown(remainingSeconds))
    }
  }, [remainingSeconds, warningThresholdSeconds, dangerThresholdSeconds])

  const status = resolveEscalationStatus(remainingSeconds, warningThresholdSeconds, dangerThresholdSeconds)

  return (
    <span data-testid="countdown-timer" style={{ display: 'inline-flex', flexDirection: 'column' }}>
      <span
        data-testid="countdown-timer-value"
        role="timer"
        aria-live="off"
        style={{
          fontFamily: MONO_FONT_STACK,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--font-weight-bold)',
          color: ESCALATION_COLOR[status],
        }}
      >
        {formatCountdown(remainingSeconds)}
      </span>
      <span data-testid="countdown-timer-announcement" aria-live="polite" style={VISUALLY_HIDDEN_STYLE}>
        {announcedText}
      </span>
    </span>
  )
}
