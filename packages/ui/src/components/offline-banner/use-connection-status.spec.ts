import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_POLL_INTERVAL_MS, useConnectionStatus } from './use-connection-status.js'

describe('useConnectionStatus — REST-поллинг при потере WS (SRS-UX-025)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('isWsConnected=false — вызывает onPoll раз в 10 секунд', () => {
    const onPoll = vi.fn()
    renderHook(() => {
      useConnectionStatus({ isWsConnected: false, onPoll })
    })

    expect(onPoll).not.toHaveBeenCalled()

    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS)
    expect(onPoll).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS * 2)
    expect(onPoll).toHaveBeenCalledTimes(3)
  })

  it('isWsConnected=true — не запускает поллинг вовсе', () => {
    const onPoll = vi.fn()
    renderHook(() => {
      useConnectionStatus({ isWsConnected: true, onPoll })
    })

    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS * 3)
    expect(onPoll).not.toHaveBeenCalled()
  })

  it('восстановление isWsConnected true останавливает дальнейший поллинг', () => {
    const onPoll = vi.fn()
    const { rerender } = renderHook(
      ({ isWsConnected }) => {
        useConnectionStatus({ isWsConnected, onPoll })
      },
      { initialProps: { isWsConnected: false } },
    )

    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS)
    expect(onPoll).toHaveBeenCalledTimes(1)

    rerender({ isWsConnected: true })
    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS * 3)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })

  it('уважает кастомный pollIntervalMs', () => {
    const onPoll = vi.fn()
    renderHook(() => {
      useConnectionStatus({ isWsConnected: false, onPoll, pollIntervalMs: 2000 })
    })

    vi.advanceTimersByTime(2000)
    expect(onPoll).toHaveBeenCalledTimes(1)
  })
})
