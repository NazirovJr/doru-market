/**
 * `useUiCircuitBreaker` (DTJ-406, «Что сделать» п.7, `SRS-UX-026`) — UI-уровневый circuit breaker:
 * после `failureThreshold` (по умолчанию 3) подряд идущих сбоев (502/503/таймаут — что считать
 * сбоем, решает потребитель, вызывая `recordFailure()`) блокирует повторные попытки на
 * `cooldownMs` (по умолчанию 60000мс) НЕЗАВИСИМО от количества кликов пользователя по кнопке
 * «Повторить» (критерий приёмки 4 тикета DTJ-406).
 *
 * ВАЖНО (риск, явно зафиксированный тикетом): состояние — ЛОКАЛЬНОЕ для инстанса хука
 * (per-эндпоинт), НЕ глобальное на всё приложение. Каждый эндпоинт ОБЯЗАН иметь СВОЙ вызов
 * `useUiCircuitBreaker({ endpointId: '...' })` — иначе сбой одного маршрута заблокирует повторные
 * попытки на другом, не связанном маршруте. Сам хук не использует `endpointId` для поиска общего
 * стора (стор — обычный `useState` этого конкретного вызова хука, естественно изолирован per-
 * инстанс) — проп существует для того, чтобы это требование было ЯВНО видно на месте вызова, а
 * не подразумевалось; пустой/дублирующийся `endpointId` между разными эндпоинтами в одном
 * компоненте — дефект использования, хук предупреждает о нём в dev-режиме (см. `warnIfMisused`).
 *
 * Сброс блокировки — по истечении `cooldownMs` ИЛИ явным вызовом `reset()` (pull-to-refresh,
 * тест-план DTJ-406 «оба пути сброса»).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export const DEFAULT_FAILURE_THRESHOLD = 3
export const DEFAULT_COOLDOWN_MS = 60000

export interface UseUiCircuitBreakerOptions {
  /** Стабильный ключ эндпоинта — см. JSDoc модуля. Обязателен, не используется для сторинга. */
  readonly endpointId: string
  readonly failureThreshold?: number
  readonly cooldownMs?: number
}

export interface UiCircuitBreakerState {
  readonly blocked: boolean
  readonly consecutiveFailures: number
  readonly recordFailure: () => void
  readonly recordSuccess: () => void
  /** Явный сброс (например, pull-to-refresh) — снимает блокировку раньше `cooldownMs`. */
  readonly reset: () => void
}

const isDevelopmentEnvironment = (): boolean => process.env.NODE_ENV !== 'production'

const warnIfMisused = (endpointId: string): void => {
  if (isDevelopmentEnvironment() && endpointId.trim() === '') {
    // eslint-disable-next-line no-console -- намеренное dev-предупреждение о неправильном использовании хука (см. JSDoc модуля), не прод-логирование.
    console.warn('[useUiCircuitBreaker] endpointId должен быть непустым и стабильным на весь эндпоинт (см. JSDoc).')
  }
}

export const useUiCircuitBreaker = ({
  endpointId,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  cooldownMs = DEFAULT_COOLDOWN_MS,
}: UseUiCircuitBreakerOptions): UiCircuitBreakerState => {
  warnIfMisused(endpointId)

  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const [blocked, setBlocked] = useState(false)
  const unblockTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearScheduledUnblock = useCallback((): void => {
    if (unblockTimerRef.current !== undefined) {
      clearTimeout(unblockTimerRef.current)
      unblockTimerRef.current = undefined
    }
  }, [])

  useEffect(() => clearScheduledUnblock, [clearScheduledUnblock])

  const reset = useCallback((): void => {
    clearScheduledUnblock()
    setConsecutiveFailures(0)
    setBlocked(false)
  }, [clearScheduledUnblock])

  const recordSuccess = useCallback((): void => {
    reset()
  }, [reset])

  const recordFailure = useCallback((): void => {
    setConsecutiveFailures((previous) => {
      const next = previous + 1
      if (next >= failureThreshold) {
        clearScheduledUnblock()
        setBlocked(true)
        unblockTimerRef.current = setTimeout(() => {
          setBlocked(false)
          setConsecutiveFailures(0)
          unblockTimerRef.current = undefined
        }, cooldownMs)
      }
      return next
    })
  }, [failureThreshold, cooldownMs, clearScheduledUnblock])

  return { blocked, consecutiveFailures, recordFailure, recordSuccess, reset }
}
