/**
 * `countdown-timer.spec.tsx` (DTJ-407, тест-план тикета, критерии приёмки 1/2).
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CountdownTimer,
  computeRemainingSeconds,
  formatCountdown,
  resolveEscalationStatus,
} from './countdown-timer'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

interface FakeClock {
  readonly getNow: () => number
  /** Продвигает и инжектируемое время, и фейковый таймер `setInterval` на N секунд, тик за тиком. */
  readonly advanceSeconds: (seconds: number) => void
}

/** Время — ЗАМЫКАНИЕ внутри фабрики (не мутация параметра функции, `no-param-reassign`). */
function createFakeClock(): FakeClock {
  let currentMs = 0
  return {
    getNow: () => currentMs,
    advanceSeconds: (seconds: number): void => {
      for (let i = 0; i < seconds; i += 1) {
        act(() => {
          currentMs += 1000
          vi.advanceTimersByTime(1000)
        })
      }
    },
  }
}

describe('computeRemainingSeconds — чистая функция, время только через getNow', () => {
  it('считает секунды до цели по инжектированному getNow, без Date.now()', () => {
    expect(computeRemainingSeconds(10000, () => 0)).toBe(10)
    expect(computeRemainingSeconds(10000, () => 10000)).toBe(0)
  })

  it('возвращает отрицательное значение для просроченной цели', () => {
    expect(computeRemainingSeconds(10000, () => 12000)).toBe(-2)
  })
})

describe('resolveEscalationStatus — пороговая эскалация', () => {
  it('default, пока remainingSeconds выше warningThresholdSeconds', () => {
    expect(resolveEscalationStatus(301, 300, 0)).toBe('default')
  })

  it('warning РОВНО на границе warningThresholdSeconds', () => {
    expect(resolveEscalationStatus(300, 300, 0)).toBe('warning')
  })

  it('danger, когда remainingSeconds <= dangerThresholdSeconds (включая просрочку)', () => {
    expect(resolveEscalationStatus(0, 300, 0)).toBe('danger')
    expect(resolveEscalationStatus(-1, 300, 0)).toBe('danger')
  })

  it('danger приоритетнее warning, если оба порога совпадают', () => {
    expect(resolveEscalationStatus(50, 100, 100)).toBe('danger')
  })
})

describe('formatCountdown — MM:SS, явный знак для просрочки', () => {
  it('форматирует положительное время без знака', () => {
    expect(formatCountdown(65)).toBe('01:05')
  })

  it('НЕ клэмпит отрицательное время к нулю — явный минус (критерий приёмки 2)', () => {
    expect(formatCountdown(-5)).toBe('-00:05')
    expect(formatCountdown(-65)).toBe('-01:05')
  })

  it('форматирует ровно ноль без знака', () => {
    expect(formatCountdown(0)).toBe('00:00')
  })
})

describe('CountdownTimer — цветовая эскалация и aria-live (критерий приёмки 1)', () => {
  it('переходит на --brand-warning РОВНО в момент достижения порога, с ОДНИМ обновлением aria-live', () => {
    const clock = createFakeClock()

    render(
      <CountdownTimer targetTimestamp={400000} warningThresholdSeconds={300} dangerThresholdSeconds={0} getNow={clock.getNow} />,
    )

    expect(screen.getByTestId('countdown-timer-value')).toHaveStyle({ color: 'var(--brand-text)' })

    const announcementNode = screen.getByTestId('countdown-timer-announcement')
    const observer = new MutationObserver(() => undefined)
    observer.observe(announcementNode, { childList: true, characterData: true, subtree: true })

    // 400с → 300с: пересекает ТОЛЬКО порог предупреждения (100 тиков).
    clock.advanceSeconds(100)
    const mutationCount = observer.takeRecords().length

    expect(screen.getByTestId('countdown-timer-value')).toHaveStyle({ color: 'var(--brand-warning)' })
    expect(mutationCount).toBe(1)
    expect(announcementNode).toHaveTextContent('05:00')

    observer.disconnect()
  })

  it('уходит в отрицательное значение и цвет --brand-danger, время НЕ скрывается (критерий приёмки 2)', () => {
    const clock = createFakeClock()

    render(
      <CountdownTimer targetTimestamp={5000} warningThresholdSeconds={3} dangerThresholdSeconds={0} getNow={clock.getNow} />,
    )

    clock.advanceSeconds(7) // 5000мс цели, 7 тиков по 1с → remaining = -2с

    expect(screen.getByTestId('countdown-timer-value')).toHaveStyle({ color: 'var(--brand-danger)' })
    expect(screen.getByTestId('countdown-timer-value')).toHaveTextContent('-00:02')
  })

  it('не обновляет aria-live регион на каждый тик, пока статус не меняется', () => {
    const clock = createFakeClock()

    render(
      <CountdownTimer targetTimestamp={100000} warningThresholdSeconds={10} dangerThresholdSeconds={0} getNow={clock.getNow} />,
    )

    const announcementNode = screen.getByTestId('countdown-timer-announcement')
    const observer = new MutationObserver(() => undefined)
    observer.observe(announcementNode, { childList: true, characterData: true, subtree: true })

    // 100с → 90с: остаётся в статусе default (порог предупреждения — 10с) — НЕ должно быть мутаций.
    clock.advanceSeconds(10)
    expect(observer.takeRecords().length).toBe(0)

    observer.disconnect()
  })
})
