import { useCallback, useEffect, useState } from 'react'

/** `SRS-UX-026`: 3 подряд `502`/`503`/таймаута блокируют повторные попытки на 60с. */
export const DEFAULT_FAILURE_THRESHOLD = 3
export const DEFAULT_BLOCK_DURATION_MS = 60_000

interface BreakerRecord {
  consecutiveFailures: number
  blockedUntilMs: number | null
}

/**
 * Реестр состояний ПО КЛЮЧУ эндпоинта (`SRS-UX-026`, риск тикета DTJ-406: «per-эндпоинт, не
 * глобально на всё приложение — иначе один упавший маршрут блокирует повторные попытки на ДРУГОМ,
 * не связанном маршруте»). Модульный `Map`, а не локальный `useState`, — состояние переживает
 * размонтирование/повторный монтаж компонента-потребителя в течение 60с блокировки (например,
 * переход между вкладками очереди сборки и обратно не сбрасывает паузу). Потребитель ОБЯЗАН
 * передавать СТАБИЛЬНЫЙ `key`, уникальный на каждый отдельный эндпоинт — общий `key` для разных
 * эндпоинтов смешает их счётчики ошибок, разный `key` для одного и того же эндпоинта отключит
 * персистентность между монтированиями.
 */
const registry = new Map<string, BreakerRecord>()

function getOrCreateRecord(key: string): BreakerRecord {
  const existing = registry.get(key)
  if (existing !== undefined) {
    return existing
  }
  const created: BreakerRecord = { consecutiveFailures: 0, blockedUntilMs: null }
  registry.set(key, created)
  return created
}

function isCurrentlyBlocked(record: BreakerRecord, nowMs: number): boolean {
  return record.blockedUntilMs !== null && record.blockedUntilMs > nowMs
}

export interface UseUiCircuitBreakerOptions {
  readonly failureThreshold?: number
  readonly blockDurationMs?: number
}

export interface UiCircuitBreakerState {
  /** `true` весь период блокировки (AC4) — кнопка «Повторить» обязана быть `disabled` независимо
   * от числа попыток клика, пока это `true`. */
  readonly blocked: boolean
  /** Фиксирует один неуспешный запрос (`502`/`503`/таймаут — классификация на стороне вызывающего
   * кода, хук не разбирает HTTP-статусы). После `failureThreshold` подряд — включает блокировку. */
  readonly recordFailure: () => void
  /** Успешный запрос сбрасывает счётчик подряд идущих ошибок. */
  readonly recordSuccess: () => void
  /** Явный pull-to-refresh — второй (помимо истечения таймера) способ снять блокировку раньше. */
  readonly pullToRefreshReset: () => void
}

/**
 * UI circuit breaker (`SRS-UX-026`, DTJ-406 п.7/AC4): после `failureThreshold` (по умолчанию 3)
 * подряд ошибок — `blocked: true` на `blockDurationMs` (по умолчанию 60с). Снимается ЛИБО
 * истечением таймера, ЛИБО явным `pullToRefreshReset()` — оба пути покрыты тест-планом.
 */
export function useUiCircuitBreaker(key: string, options?: UseUiCircuitBreakerOptions): UiCircuitBreakerState {
  const failureThreshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD
  const blockDurationMs = options?.blockDurationMs ?? DEFAULT_BLOCK_DURATION_MS

  const [, forceRerender] = useState(0)
  const record = getOrCreateRecord(key)
  const blocked = isCurrentlyBlocked(record, Date.now())

  useEffect(() => {
    if (record.blockedUntilMs === null) {
      return undefined
    }
    const remainingMs = Math.max(0, record.blockedUntilMs - Date.now())
    const timeoutId = window.setTimeout(() => {
      forceRerender((tick) => tick + 1)
    }, remainingMs)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [record, record.blockedUntilMs])

  const recordFailure = useCallback((): void => {
    record.consecutiveFailures += 1
    if (record.consecutiveFailures >= failureThreshold) {
      record.blockedUntilMs = Date.now() + blockDurationMs
    }
    forceRerender((tick) => tick + 1)
  }, [record, failureThreshold, blockDurationMs])

  const recordSuccess = useCallback((): void => {
    record.consecutiveFailures = 0
    forceRerender((tick) => tick + 1)
  }, [record])

  const pullToRefreshReset = useCallback((): void => {
    record.consecutiveFailures = 0
    record.blockedUntilMs = null
    forceRerender((tick) => tick + 1)
  }, [record])

  return { blocked, recordFailure, recordSuccess, pullToRefreshReset }
}
