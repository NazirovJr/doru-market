import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_BLOCK_DURATION_MS,
  DEFAULT_FAILURE_THRESHOLD,
  useUiCircuitBreaker,
} from './use-ui-circuit-breaker.js'

let keySequence = 0
function nextKey(): string {
  keySequence += 1
  return `test-endpoint-${String(keySequence)}`
}

describe('useUiCircuitBreaker — 3 подряд ошибки блокируют на 60с (AC4, SRS-UX-026)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('после 3 подряд recordFailure() blocked становится true', () => {
    const key = nextKey()
    const { result } = renderHook(() => useUiCircuitBreaker(key))

    expect(result.current.blocked).toBe(false)

    act(() => {
      result.current.recordFailure()
    })
    act(() => {
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(false)

    act(() => {
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)
  })

  it('4-й клик «Повторить» во время блокировки не снимает её — blocked остаётся true весь период', () => {
    const key = nextKey()
    const { result } = renderHook(() => useUiCircuitBreaker(key))

    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => {
      vi.advanceTimersByTime(DEFAULT_BLOCK_DURATION_MS - 1)
    })
    expect(result.current.blocked).toBe(true)
  })

  it('блокировка снимается по истечении 60с таймера', () => {
    const key = nextKey()
    const { result } = renderHook(() => useUiCircuitBreaker(key))

    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => {
      vi.advanceTimersByTime(DEFAULT_BLOCK_DURATION_MS)
    })
    expect(result.current.blocked).toBe(false)
  })

  it('блокировка снимается явным pullToRefreshReset() ДО истечения таймера', () => {
    const key = nextKey()
    const { result } = renderHook(() => useUiCircuitBreaker(key))

    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => {
      result.current.pullToRefreshReset()
    })
    expect(result.current.blocked).toBe(false)

    act(() => {
      vi.advanceTimersByTime(DEFAULT_BLOCK_DURATION_MS)
    })
    expect(result.current.blocked).toBe(false)
  })

  it('успешный запрос сбрасывает счётчик подряд идущих ошибок (2 ошибки + успех + 2 ошибки — не блокирует)', () => {
    const key = nextKey()
    const { result } = renderHook(() => useUiCircuitBreaker(key))

    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
      result.current.recordSuccess()
      result.current.recordFailure()
      result.current.recordFailure()
    })

    expect(result.current.blocked).toBe(false)
  })

  it(`уважает кастомный failureThreshold/blockDurationMs`, () => {
    const key = nextKey()
    const { result } = renderHook(() =>
      useUiCircuitBreaker(key, { failureThreshold: 2, blockDurationMs: 5000 }),
    )

    act(() => {
      result.current.recordFailure()
      result.current.recordFailure()
    })
    expect(result.current.blocked).toBe(true)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.blocked).toBe(false)
  })
})

describe('useUiCircuitBreaker — состояние ПО КЛЮЧУ, не глобально на всё приложение (риск тикета)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('блокировка одного endpointId не влияет на другой', () => {
    const keyA = nextKey()
    const keyB = nextKey()
    const hookA = renderHook(() => useUiCircuitBreaker(keyA))
    const hookB = renderHook(() => useUiCircuitBreaker(keyB))

    act(() => {
      hookA.result.current.recordFailure()
      hookA.result.current.recordFailure()
      hookA.result.current.recordFailure()
    })

    expect(hookA.result.current.blocked).toBe(true)
    expect(hookB.result.current.blocked).toBe(false)
  })

  it('состояние переживает размонтирование/повторный монтаж того же key (персистентность в окне блокировки)', () => {
    const key = nextKey()
    const first = renderHook(() => useUiCircuitBreaker(key))

    act(() => {
      first.result.current.recordFailure()
      first.result.current.recordFailure()
      first.result.current.recordFailure()
    })
    expect(first.result.current.blocked).toBe(true)
    first.unmount()

    const second = renderHook(() => useUiCircuitBreaker(key))
    expect(second.result.current.blocked).toBe(true)
  })
})

describe('useUiCircuitBreaker — дефолты соответствуют SRS-UX-026', () => {
  it('DEFAULT_FAILURE_THRESHOLD=3, DEFAULT_BLOCK_DURATION_MS=60000', () => {
    expect(DEFAULT_FAILURE_THRESHOLD).toBe(3)
    expect(DEFAULT_BLOCK_DURATION_MS).toBe(60_000)
  })
})
