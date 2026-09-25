/**
 * `use-ui-circuit-breaker.spec.ts` (DTJ-406, критерий приёмки 4, тест-план тикета: «3
 * последовательные ошибки → блокировка 60с; успешный запрос сбрасывает счётчик; блокировка
 * снимается по истечении таймера ИЛИ явным pull-to-refresh — проверяется оба пути сброса»).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_FAILURE_THRESHOLD,
  useUiCircuitBreaker,
} from './use-ui-circuit-breaker'

afterEach(() => {
  vi.useRealTimers()
})

describe('useUiCircuitBreaker — блокировка после порога сбоев (AC4)', () => {
  it('блокирует ТОЛЬКО после failureThreshold (3) подряд идущих сбоев', () => {
    const { result } = renderHook(() => useUiCircuitBreaker({ endpointId: 'orders.list' }))

    act(() => { result.current.recordFailure() })
    expect(result.current.blocked).toBe(false)
    expect(result.current.consecutiveFailures).toBe(1)

    act(() => { result.current.recordFailure() })
    expect(result.current.blocked).toBe(false)

    act(() => { result.current.recordFailure() })
    expect(result.current.blocked).toBe(true)
    expect(result.current.consecutiveFailures).toBe(DEFAULT_FAILURE_THRESHOLD)
  })

  it('4-й вызов (например, клик «Повторить») не снимает блокировку — остаётся blocked=true', () => {
    const { result } = renderHook(() => useUiCircuitBreaker({ endpointId: 'orders.list' }))
    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => { result.current.recordFailure() })
    expect(result.current.blocked).toBe(true)
  })

  it('снимает блокировку по истечении cooldownMs (60с по умолчанию) — путь 1 из 2', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useUiCircuitBreaker({ endpointId: 'orders.list' }))
    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => { vi.advanceTimersByTime(DEFAULT_COOLDOWN_MS - 1) })
    expect(result.current.blocked).toBe(true)

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.blocked).toBe(false)
    expect(result.current.consecutiveFailures).toBe(0)
  })

  it('снимает блокировку раньше таймера явным reset() (pull-to-refresh) — путь 2 из 2', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useUiCircuitBreaker({ endpointId: 'orders.list' }))
    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => { result.current.reset() })
    expect(result.current.blocked).toBe(false)
    expect(result.current.consecutiveFailures).toBe(0)

    // Таймер отменён reset() — истечение исходного cooldown не блокирует повторно.
    act(() => { vi.advanceTimersByTime(DEFAULT_COOLDOWN_MS) })
    expect(result.current.blocked).toBe(false)
  })

  it('успешный запрос сбрасывает счётчик сбоев ДО достижения порога', () => {
    const { result } = renderHook(() => useUiCircuitBreaker({ endpointId: 'orders.list' }))
    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.consecutiveFailures).toBe(2)

    act(() => { result.current.recordSuccess() })
    expect(result.current.consecutiveFailures).toBe(0)
    expect(result.current.blocked).toBe(false)
  })

  it('поддерживает настраиваемые failureThreshold/cooldownMs', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useUiCircuitBreaker({ endpointId: 'orders.list', failureThreshold: 2, cooldownMs: 5000 }),
    )
    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.blocked).toBe(false)
  })
})

describe('useUiCircuitBreaker — dev-предупреждение о неправильном использовании', () => {
  it('логирует console.warn, когда endpointId пустой', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renderHook(() => useUiCircuitBreaker({ endpointId: '   ' }))
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('НЕ логирует, когда endpointId непустой', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    renderHook(() => useUiCircuitBreaker({ endpointId: 'orders.list' }))
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('useUiCircuitBreaker — состояние per-инстанс (per-эндпоинт, не глобальное)', () => {
  it('два независимых вызова хука (два разных endpointId) не делят состояние', () => {
    const { result: ordersResult } = renderHook(() => useUiCircuitBreaker({ endpointId: 'orders.list' }))
    const { result: cartResult } = renderHook(() => useUiCircuitBreaker({ endpointId: 'cart.sync' }))

    act(() => {
      ordersResult.current.recordFailure()
      ordersResult.current.recordFailure()
      ordersResult.current.recordFailure()
    })

    expect(ordersResult.current.blocked).toBe(true)
    expect(cartResult.current.blocked).toBe(false)
    expect(cartResult.current.consecutiveFailures).toBe(0)
  })
})
