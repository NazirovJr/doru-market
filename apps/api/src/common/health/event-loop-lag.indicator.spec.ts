import { describe, expect, it } from 'vitest'
import { isEventLoopLagHealthy } from '@/common/health/event-loop-lag.indicator'

describe('isEventLoopLagHealthy', () => {
  it('здоров при лаге значительно ниже порога', () => {
    expect(isEventLoopLagHealthy(5)).toBe(true)
  })

  it('нездоров при лаге на пороге и выше', () => {
    expect(isEventLoopLagHealthy(1000)).toBe(false)
    expect(isEventLoopLagHealthy(5000)).toBe(false)
  })

  it('нездоров при нечисловых значениях (NaN/Infinity) — не «тихо здоров»', () => {
    expect(isEventLoopLagHealthy(Number.NaN)).toBe(false)
    expect(isEventLoopLagHealthy(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('здоров при нулевом лаге (холодный старт)', () => {
    expect(isEventLoopLagHealthy(0)).toBe(true)
  })
})
